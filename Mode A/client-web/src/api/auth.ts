import { axiosBase } from '@/config/axiosBase'
import { authFetcher } from '@/config/authFetcher'
import type { StudentIdentity } from '@/types/auth'

export async function loginStudentApi(universityId: string, studentId: number, password: string): Promise<StudentIdentity> {
  const response = await axiosBase.post<StudentIdentity>('/student/login', { universityId, studentId, password })
  return response.data
}

export async function logoutStudentApi(): Promise<void> {
  await authFetcher('/student/logout', { method: 'POST' })
}

export async function changeStudentPasswordApi(currentPassword: string, newPassword: string): Promise<void> {
  await authFetcher('/student/password', { method: 'POST', data: { currentPassword, newPassword } })
}
