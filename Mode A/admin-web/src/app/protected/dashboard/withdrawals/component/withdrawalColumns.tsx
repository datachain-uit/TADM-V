import Badge from '@/components/Badge'
import Button from '@/components/Button'
import type { Column } from '@/components/DataTable'
import type { WithdrawalEntity } from '@/types/withdrawal'
import { formatDate } from '@/utils/date'
import { formatEth, shortHex } from '@/utils/format'

export interface WithdrawalRowActions {
  busy: boolean
  isFinance: boolean
  approve: (item: WithdrawalEntity) => void
  reject: (item: WithdrawalEntity) => void
}

export function buildWithdrawalColumns(actions: WithdrawalRowActions): Column<WithdrawalEntity>[] {
  return [
    { header: 'Request', render: (w) => <code title={w.requestId}>{shortHex(w.requestId)}</code> },
    { header: 'Amount', render: (w) => formatEth(w.amountWei) },
    { header: 'Recipient wallet', render: (w) => <code title={w.recipient}>{shortHex(w.recipient)}</code> },
    { header: 'Submitted at', render: (w) => formatDate(w.createdAt) },
    { header: 'Status', render: (w) => <Badge status={w.status} /> },
    {
      header: 'Actions',
      render: (w) =>
        actions.isFinance && w.canReview ? (
          <div className="row-actions">
            <Button disabled={actions.busy} onClick={() => actions.approve(w)}>Approve · pay out</Button>
            <Button variant="danger" disabled={actions.busy} onClick={() => actions.reject(w)}>Reject</Button>
          </div>
        ) : (
          <code title={w.transactionHash ?? ''}>{shortHex(w.transactionHash)}</code>
        ),
    },
  ]
}
