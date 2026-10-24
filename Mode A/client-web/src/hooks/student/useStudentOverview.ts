import { useQuery } from '@tanstack/react-query'
import { getStudentOverviewService } from '@/services/student'

export const STUDENT_OVERVIEW_KEY = ['student-overview']

export function useStudentOverview() {
  const { data, isLoading, error } = useQuery({ queryKey: STUDENT_OVERVIEW_KEY, queryFn: getStudentOverviewService })
  return { overview: data ?? null, isLoading, error: error ? error.message : null }
}
