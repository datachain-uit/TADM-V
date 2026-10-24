import { useMutation, useQueryClient } from '@tanstack/react-query'
import { issueScholarshipService } from '@/services/scholarship'
import { STUDENTS_KEY } from '../student/useStudents'

export function useScholarshipActions() {
  const queryClient = useQueryClient()
  const issue = useMutation({
    mutationFn: (studentId: number) => issueScholarshipService(studentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
  })
  return { issue: issue.mutateAsync }
}
