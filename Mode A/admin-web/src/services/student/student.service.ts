import { adaptStudents } from '@/adapters/student'
import { approveFinanceApi, createStudentApi, getAllStudentsApi, registerWalletApi, reviewEligibilityApi, setTemporaryPasswordApi } from '@/api/student'
import type { Decision } from '@/types/auth'
import type { StudentEntity } from '@/types/student'
import { ethToWei } from '@/utils/format'

export async function getStudentsService(): Promise<StudentEntity[]> {
  return adaptStudents(await getAllStudentsApi())
}

export async function createStudentService(studentId: number, email: string): Promise<void> {
  await createStudentApi(studentId, email.trim())
}

export async function reviewEligibilityService(studentId: number, decision: Decision): Promise<void> {
  await reviewEligibilityApi(studentId, decision)
}

export async function approveFinanceService(studentId: number, amountEth: string): Promise<void> {
  await approveFinanceApi(studentId, ethToWei(amountEth))
}

export async function registerWalletService(poolId: string, email: string, walletAddress: string, publicKey: string): Promise<void> {
  await registerWalletApi(poolId, email.trim(), walletAddress.trim(), publicKey.trim())
}

export async function setTemporaryPasswordService(studentId: number, temporaryPassword: string): Promise<void> {
  await setTemporaryPasswordApi(studentId, temporaryPassword)
}
