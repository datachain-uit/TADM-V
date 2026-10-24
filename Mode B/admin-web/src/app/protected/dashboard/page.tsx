import CardSection from '@/components/CardSection'
import Loading from '@/components/Loading'
import PageHeader from '@/components/PageHeader'
import { usePermission } from '@/hooks/usePermission'
import { usePools } from '@/hooks/pool'
import { useStudents } from '@/hooks/student'
import { useWithdrawals } from '@/hooks/withdrawal'

export default function DashboardPage() {
  const { is } = usePermission()
  const isAffairs = is('STUDENT_AFFAIRS')
  const { students, isLoading, error } = useStudents()
  const { pools } = usePools()
  const { withdrawals } = useWithdrawals('PENDING_APPROVAL')

  return (
    <>
      <PageHeader title="Overview" description="Items waiting for your office" />
      <Loading isLoading={isLoading} error={error} />
      <div className="stat-grid">
        <CardSection title="Students">
          <p className="stat">{students.length}</p>
          <p className="muted">
            {students.filter((s) => s.eligibilityStatus === 'PENDING').length} awaiting eligibility review ·{' '}
            {students.filter((s) => s.eligibilityStatus === 'ELIGIBLE' && s.financeStatus === 'PENDING').length} awaiting funding approval
          </p>
        </CardSection>
        <CardSection title="Deployed pools">
          <p className="stat">{pools.filter((p) => p.isDeployed).length}</p>
          <p className="muted">of {pools.length} pools in total</p>
        </CardSection>
        {isAffairs && (
          <CardSection title="Waiting for a registered wallet">
            <p className="stat">{students.filter((s) => s.eligibilityStatus === 'ELIGIBLE' && s.financeStatus === 'APPROVED').length}</p>
            <p className="muted">approved students; register their wallet and note public key on the Students page</p>
          </CardSection>
        )}
        <CardSection title="Pending withdrawal requests">
          <p className="stat">{withdrawals.length}</p>
        </CardSection>
      </div>
    </>
  )
}
