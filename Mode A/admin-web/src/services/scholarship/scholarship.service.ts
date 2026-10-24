import { issueScholarshipApi } from '@/api/scholarship'

export async function issueScholarshipService(studentId: number): Promise<void> {
  await issueScholarshipApi(studentId)
}
