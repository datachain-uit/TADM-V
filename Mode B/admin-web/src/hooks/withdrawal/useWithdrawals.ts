import { useQuery } from '@tanstack/react-query'
import { getWithdrawalsService } from '@/services/withdrawal'
import type { WithdrawalStatus } from '@/types/withdrawal'

export const WITHDRAWALS_KEY = ['withdrawals']

export function useWithdrawals(status?: WithdrawalStatus) {
  const { data, isLoading, error } = useQuery({
    queryKey: [...WITHDRAWALS_KEY, status ?? 'ALL'],
    queryFn: () => getWithdrawalsService(status),
  })
  return { withdrawals: data ?? [], isLoading, error: error ? error.message : null }
}
