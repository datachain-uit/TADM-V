import { adaptWithdrawals } from '@/adapters/withdrawal'
import { getWithdrawalsApi, reviewWithdrawalApi } from '@/api/withdrawal'
import type { Decision } from '@/types/auth'
import type { WithdrawalEntity, WithdrawalStatus } from '@/types/withdrawal'

export async function getWithdrawalsService(status?: WithdrawalStatus): Promise<WithdrawalEntity[]> {
  return adaptWithdrawals(await getWithdrawalsApi(status))
}

export async function reviewWithdrawalService(requestId: string, decision: Decision): Promise<void> {
  await reviewWithdrawalApi(requestId, decision)
}
