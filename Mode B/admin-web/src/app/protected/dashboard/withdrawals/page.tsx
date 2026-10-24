import { useState } from 'react'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import DataTable from '@/components/DataTable'
import Loading from '@/components/Loading'
import Notice from '@/components/Notice'
import PageHeader from '@/components/PageHeader'
import { useActionNotice } from '@/hooks/useActionNotice'
import { usePermission } from '@/hooks/usePermission'
import { useWithdrawalActions, useWithdrawals } from '@/hooks/withdrawal'
import type { WithdrawalEntity, WithdrawalStatus } from '@/types/withdrawal'
import { shortHex } from '@/utils/format'
import { buildWithdrawalColumns } from './component/withdrawalColumns'

const FILTERS: { value: WithdrawalStatus | undefined; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'Pending' },
  { value: undefined, label: 'All' },
]

export default function WithdrawalsPage() {
  const { is } = usePermission()
  const [status, setStatus] = useState<WithdrawalStatus | undefined>('PENDING_APPROVAL')
  const { withdrawals, isLoading, error } = useWithdrawals(status)
  const { review } = useWithdrawalActions()
  const { busy, message, run } = useActionNotice()

  function decide(item: WithdrawalEntity, decision: 'approve' | 'reject') {
    const label = decision === 'approve' ? 'approve and pay out' : 'reject'
    if (window.confirm(`Confirm: ${label} request ${shortHex(item.requestId)}?`)) {
      void run(() => review({ requestId: item.requestId, decision }), `Done: ${label}`)
    }
  }

  const columns = buildWithdrawalColumns({
    busy,
    isFinance: is('FINANCE'),
    approve: (w) => decide(w, 'approve'),
    reject: (w) => decide(w, 'reject'),
  })

  return (
    <>
      <PageHeader
        title="Withdrawal requests"
        description="When the student submitted the note, the university backend generated the proof and the contract verified it on-chain (verifyAndRecord). The Finance Office approves so the contract pays out (settle) to the recorded wallet."
        actions={FILTERS.map((filter) => (
          <Button key={filter.label} variant={filter.value === status ? 'primary' : 'secondary'} onClick={() => setStatus(filter.value)}>
            {filter.label}
          </Button>
        ))}
      />
      <CardSection>
        <Notice message={message} />
        <Loading isLoading={isLoading} error={error} />
        {!isLoading && <DataTable rows={withdrawals} columns={columns} rowKey={(w) => w.requestId} empty="No requests" />}
      </CardSection>
    </>
  )
}
