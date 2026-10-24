import Badge from '@/components/Badge'
import Button from '@/components/Button'
import type { Column } from '@/components/DataTable'
import type { StudentEntity } from '@/types/student'
import { formatEth } from '@/utils/format'
import { ACCOUNT_LABEL } from '@/utils/labels'

export interface StudentRowActions {
  busy: boolean
  isAffairs: boolean
  isFinance: boolean
  approveEligibility: (student: StudentEntity) => void
  rejectEligibility: (student: StudentEntity) => void
  setTemporaryPassword: (student: StudentEntity) => void
  approveFinance: (student: StudentEntity) => void
}

export function buildStudentColumns(actions: StudentRowActions): Column<StudentEntity>[] {
  const { busy, isAffairs, isFinance } = actions
  return [
    { header: 'Student ID', render: (s) => s.studentId },
    { header: 'Email', render: (s) => s.email },
    { header: 'Eligibility', render: (s) => <Badge status={s.eligibilityStatus} /> },
    { header: 'Funding', render: (s) => <Badge status={s.financeStatus} /> },
    { header: 'Amount', render: (s) => formatEth(s.amountWei) },
    { header: 'Account', render: (s) => ACCOUNT_LABEL[s.accountState] },
    {
      header: 'Actions',
      render: (s) => (
        <div className="row-actions">
          {isAffairs && s.eligibilityStatus === 'PENDING' && (
            <>
              <Button disabled={busy} onClick={() => actions.approveEligibility(s)}>Eligible</Button>
              <Button variant="danger" disabled={busy} onClick={() => actions.rejectEligibility(s)}>Reject</Button>
            </>
          )}
          {isAffairs && (
            <Button variant="secondary" disabled={busy} onClick={() => actions.setTemporaryPassword(s)}>Temporary password</Button>
          )}
          {isFinance && s.eligibilityStatus === 'ELIGIBLE' && s.financeStatus === 'PENDING' && (
            <Button disabled={busy} onClick={() => actions.approveFinance(s)}>Approve funding</Button>
          )}
        </div>
      ),
    },
  ]
}
