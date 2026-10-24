import { axiosBase } from '@/config/axiosBase'
import { authFetcher } from '@/config/authFetcher'
import type { StaffIdentity } from '@/types/auth'

export async function loginStaffApi(universityId: string, staffId: string, password: string): Promise<StaffIdentity> {
  const response = await axiosBase.post<StaffIdentity>('/staff/login', { universityId, staffId, password })
  return response.data
}

export async function logoutStaffApi(): Promise<void> {
  await authFetcher('/staff/logout', { method: 'POST' })
}

export async function getStaffMeApi(): Promise<StaffIdentity> {
  return authFetcher<StaffIdentity>('/staff/me', { method: 'GET' })
}

export async function changeStaffPasswordApi(password: string): Promise<void> {
  await authFetcher('/staff/password', { method: 'POST', data: { password } })
}
