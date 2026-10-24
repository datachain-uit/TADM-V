import { authFetcher } from '@/config/authFetcher'
import type { EncryptedNoteRaw, WithdrawalSubmission, WithdrawalSubmitResultRaw } from '@/types/withdrawal'

export async function getEncryptedNoteApi(poolId: string): Promise<EncryptedNoteRaw> {
  return authFetcher<EncryptedNoteRaw>('/student/note', { method: 'GET', params: { poolId } })
}

export async function submitWithdrawalApi(submission: WithdrawalSubmission): Promise<WithdrawalSubmitResultRaw> {
  return authFetcher<WithdrawalSubmitResultRaw>('/student/withdrawal', { method: 'POST', data: submission })
}
