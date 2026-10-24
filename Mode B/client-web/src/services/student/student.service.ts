import { adaptStudentOverview } from '@/adapters/student'
import { getStudentOverviewApi } from '@/api/student'
import type { StudentOverviewEntity } from '@/types/student'

export async function getStudentOverviewService(): Promise<StudentOverviewEntity> {
  return adaptStudentOverview(await getStudentOverviewApi())
}
