import type { WithdrawalEntity, WithdrawalRaw } from '@/types/withdrawal'

export function adaptWithdrawal(raw: WithdrawalRaw): WithdrawalEntity {
  return { ...raw, canReview: raw.status === 'PENDING_APPROVAL' || raw.status === 'EXECUTION_FAILED' }
}

export function adaptWithdrawals(raws: WithdrawalRaw[]): WithdrawalEntity[] {
  return raws.map(adaptWithdrawal)
}
