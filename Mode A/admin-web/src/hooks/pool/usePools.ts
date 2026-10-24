import { useQuery } from '@tanstack/react-query'
import { getPoolsService } from '@/services/pool'

export const POOLS_KEY = ['pools']

export function usePools() {
  const { data, isLoading, error } = useQuery({ queryKey: POOLS_KEY, queryFn: getPoolsService })
  return { pools: data ?? [], isLoading, error: error ? error.message : null }
}
