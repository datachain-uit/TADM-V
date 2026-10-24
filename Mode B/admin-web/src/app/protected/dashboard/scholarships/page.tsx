import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import DataTable, { type Column } from '@/components/DataTable'
import Loading from '@/components/Loading'
import Notice from '@/components/Notice'
import PageHeader from '@/components/PageHeader'
import { useActionNotice } from '@/hooks/useActionNotice'
import { usePoolActions, usePools } from '@/hooks/pool'
import { useScholarshipActions } from '@/hooks/scholarship'
import { useStudents } from '@/hooks/student'
import type { PoolEntity } from '@/types/pool'
import type { StudentEntity } from '@/types/student'
import { formatEth, shortHex } from '@/utils/format'

export default function ScholarshipsPage() {
  const { students, isLoading, error } = useStudents()
  const { pools } = usePools()
  const { issue } = useScholarshipActions()
  const { approveRoot } = usePoolActions()
  const { busy, message, run } = useActionNotice()

  const studentColumns: Column<StudentEntity>[] = [
    { header: 'Student ID', render: (s) => s.studentId },
    { header: 'Email', render: (s) => s.email },
    { header: 'Amount', render: (s) => formatEth(s.amountWei) },
    {
      header: 'Actions',
      render: (s) => (
        <Button disabled={busy} onClick={() => run(() => issue(s.studentId), `Scholarship issued to ${s.studentId}`)}>
          Issue scholarship
        </Button>
      ),
    },
  ]

  const poolColumns: Column<PoolEntity>[] = [
    { header: 'Program', render: (p) => p.programName },
    { header: 'Contract', render: (p) => <code title={p.contractAddress ?? ''}>{shortHex(p.contractAddress)}</code> },
    { header: 'Current root', render: (p) => <code title={p.currentRoot ?? ''}>{shortHex(p.currentRoot)}</code> },
    {
      header: 'Actions',
      render: (p) => (
        <Button disabled={busy} onClick={() => run(() => approveRoot(p.poolId), `New root approved for ${p.programName}`)}>
          Approve root
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Issue scholarships · approve root"
        description="Issuing a scholarship creates an encrypted note and uploads it to IPFS. After issuing, approve the root to put the new commitments on the contract."
      />
      <Notice message={message} />
      <Loading isLoading={isLoading} error={error} />
      <CardSection title="Students approved for eligibility and funding">
        <p className="muted">A scholarship can only be issued once the Student Affairs Office has registered the student’s wallet and note public key on the Students page; otherwise the backend returns an error.</p>
        <DataTable rows={students.filter((s) => s.readyForScholarship)} columns={studentColumns} rowKey={(s) => String(s.studentId)} />
      </CardSection>
      <CardSection title="Approve root per pool">
        <DataTable rows={pools.filter((p) => p.isDeployed)} columns={poolColumns} rowKey={(p) => p.poolId} empty="No deployed pools yet" />
      </CardSection>
    </>
  )
}
