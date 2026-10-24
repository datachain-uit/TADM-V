import { authFetcher } from '@/config/authFetcher'
import type { Decision } from '@/types/auth'
import type { WithdrawalRaw, WithdrawalStatus } from '@/types/withdrawal'

export async function getWithdrawalsApi(status?: WithdrawalStatus): Promise<WithdrawalRaw[]> {
  return authFetcher<WithdrawalRaw[]>('/withdrawals', { method: 'GET', params: status ? { status } : {} })
}

export async function reviewWithdrawalApi(requestId: string, decision: Decision): Promise<void> {
  await authFetcher(`/withdrawals/${requestId}/review`, { method: 'POST', data: { decision } })
}
