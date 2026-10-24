import { authFetcher } from '@/config/authFetcher'

export async function issueScholarshipApi(studentId: number): Promise<void> {
  await authFetcher('/scholarships', { method: 'POST', data: { studentId } })
}
