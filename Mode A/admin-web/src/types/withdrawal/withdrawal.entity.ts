import type { WithdrawalRaw } from './withdrawal.raw'

export interface WithdrawalEntity extends WithdrawalRaw {
  canReview: boolean
}
