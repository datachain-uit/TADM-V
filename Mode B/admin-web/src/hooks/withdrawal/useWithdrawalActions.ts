import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewWithdrawalService } from '@/services/withdrawal'
import type { Decision } from '@/types/auth'
import { WITHDRAWALS_KEY } from './useWithdrawals'

export function useWithdrawalActions() {
  const queryClient = useQueryClient()
  const review = useMutation({
    mutationFn: (v: { requestId: string; decision: Decision }) => reviewWithdrawalService(v.requestId, v.decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WITHDRAWALS_KEY }),
  })
  return { review: review.mutateAsync }
}
