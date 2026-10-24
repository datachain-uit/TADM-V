import { authFetcher } from '@/config/authFetcher'
import type { Decision } from '@/types/auth'
import type { StudentRaw } from '@/types/student'

export async function getAllStudentsApi(): Promise<StudentRaw[]> {
  return authFetcher<StudentRaw[]>('/students', { method: 'GET' })
}

export async function createStudentApi(studentId: number, email: string): Promise<void> {
  await authFetcher('/students', { method: 'POST', data: { studentId, email } })
}

export async function reviewEligibilityApi(studentId: number, decision: Decision): Promise<void> {
  await authFetcher(`/students/${studentId}/eligibility`, { method: 'POST', data: { decision } })
}

export async function approveFinanceApi(studentId: number, amountWei: string): Promise<void> {
  await authFetcher(`/students/${studentId}/finance`, { method: 'POST', data: { amountWei } })
}

export async function registerWalletApi(poolId: string, email: string, walletAddress: string, publicKey: string): Promise<void> {
  await authFetcher('/students/wallet', { method: 'POST', data: { poolId, email, walletAddress, publicKey } })
}

export async function setTemporaryPasswordApi(studentId: number, temporaryPassword: string): Promise<void> {
  await authFetcher(`/students/${studentId}/password`, { method: 'POST', data: { temporaryPassword } })
}
