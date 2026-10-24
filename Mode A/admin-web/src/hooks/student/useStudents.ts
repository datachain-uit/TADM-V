import { useQuery } from '@tanstack/react-query'
import { getStudentsService } from '@/services/student'

export const STUDENTS_KEY = ['students']

export function useStudents() {
  const { data, isLoading, error } = useQuery({ queryKey: STUDENTS_KEY, queryFn: getStudentsService })
  return { students: data ?? [], isLoading, error: error ? error.message : null }
}
