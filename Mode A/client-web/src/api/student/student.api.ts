import { authFetcher } from '@/config/authFetcher'
import type { StudentOverviewRaw } from '@/types/student'

export async function getStudentOverviewApi(): Promise<StudentOverviewRaw> {
  return authFetcher<StudentOverviewRaw>('/student/me', { method: 'GET' })
}
