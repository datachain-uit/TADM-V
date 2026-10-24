import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  approveFinanceService,
  createStudentService,
  registerWalletService,
  reviewEligibilityService,
  setTemporaryPasswordService,
} from '@/services/student'
import type { Decision } from '@/types/auth'
import { STUDENTS_KEY } from './useStudents'

export function useStudentActions() {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: STUDENTS_KEY })

  const create = useMutation({ mutationFn: (v: { studentId: number; email: string }) => createStudentService(v.studentId, v.email), onSuccess })
  const reviewEligibility = useMutation({ mutationFn: (v: { studentId: number; decision: Decision }) => reviewEligibilityService(v.studentId, v.decision), onSuccess })
  const approveFinance = useMutation({ mutationFn: (v: { studentId: number; amountEth: string }) => approveFinanceService(v.studentId, v.amountEth), onSuccess })
  const registerWallet = useMutation({
    mutationFn: (v: { poolId: string; email: string; walletAddress: string; publicKey: string }) =>
      registerWalletService(v.poolId, v.email, v.walletAddress, v.publicKey),
    onSuccess,
  })
  const setTemporaryPassword = useMutation({ mutationFn: (v: { studentId: number; password: string }) => setTemporaryPasswordService(v.studentId, v.password), onSuccess })

  return {
    create: create.mutateAsync,
    reviewEligibility: reviewEligibility.mutateAsync,
    approveFinance: approveFinance.mutateAsync,
    setTemporaryPassword: setTemporaryPassword.mutateAsync,
    registerWallet: registerWallet.mutateAsync,
  }
}
