import CardSection from '@/components/CardSection'
import DataTable from '@/components/DataTable'
import Loading from '@/components/Loading'
import Notice from '@/components/Notice'
import PageHeader from '@/components/PageHeader'
import { useActionNotice } from '@/hooks/useActionNotice'
import { usePermission } from '@/hooks/usePermission'
import { useStudentActions, useStudents } from '@/hooks/student'
import CreateStudentForm from './component/CreateStudentForm'
import RegisterWalletForm from './component/RegisterWalletForm'
import { buildStudentColumns } from './component/studentColumns'

export default function StudentsPage() {
  const { is } = usePermission()
  const isAffairs = is('STUDENT_AFFAIRS')
  const isFinance = is('FINANCE')
  const { students, isLoading, error } = useStudents()
  const { reviewEligibility, approveFinance, setTemporaryPassword } = useStudentActions()
  const { busy, message, run } = useActionNotice()

  const columns = buildStudentColumns({
    busy,
    isAffairs,
    isFinance,
    approveEligibility: (s) => void run(() => reviewEligibility({ studentId: s.studentId, decision: 'approve' }), `${s.studentId}: eligible`),
    rejectEligibility: (s) => void run(() => reviewEligibility({ studentId: s.studentId, decision: 'reject' }), `${s.studentId}: rejected`),
    setTemporaryPassword: (s) => {
      const password = window.prompt(`TEMPORARY password for ${s.studentId} (at least 8 characters). The student must change it at first sign-in.`)
      if (password) void run(() => setTemporaryPassword({ studentId: s.studentId, password }), `Temporary password set for ${s.studentId}`)
    },
    approveFinance: (s) => {
      const amountEth = window.prompt(`Scholarship amount for ${s.studentId} (ETH)`, '0.1')
      if (amountEth) void run(() => approveFinance({ studentId: s.studentId, amountEth }), `Funding of ${amountEth} ETH approved for ${s.studentId}`)
    },
  })

  return (
    <>
      <PageHeader title="Students" description="Records, eligibility review and wallet registration (Student Affairs), funding approval (Finance), sign-in accounts" />
      {isAffairs && <CreateStudentForm />}
      {isAffairs && <RegisterWalletForm />}
      <CardSection>
        <Notice message={message} />
        <Loading isLoading={isLoading} error={error} />
        {!isLoading && <DataTable rows={students} columns={columns} rowKey={(s) => String(s.studentId)} />}
      </CardSection>
    </>
  )
}
