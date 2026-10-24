import { create } from 'zustand'
import { changeStudentPasswordApi, loginStudentApi, logoutStudentApi } from '@/api/auth'
import { getStudentOverviewApi } from '@/api/student'
import type { StudentSession } from '@/types/auth'
import { useSecretsStore } from './secretsSlice'

interface AuthState {
  session: StudentSession | null
  checked: boolean
  restore: () => Promise<void>
  login: (universityId: string, studentId: number, password: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  checked: false,

  restore: async () => {
    const overview = await getStudentOverviewApi().catch(() => null)
    const session = overview ? { studentId: overview.studentId, mustChangePassword: overview.mustChangePassword } : null
    set((state) => (state.checked ? state : { session, checked: true }))
  },

  login: async (universityId, studentId, password) => {
    const identity = await loginStudentApi(universityId, studentId, password)
    set({ session: { studentId: identity.studentId, mustChangePassword: identity.mustChangePassword }, checked: true })
  },

  changePassword: async (currentPassword, newPassword) => {
    await changeStudentPasswordApi(currentPassword, newPassword)
    set((state) => (state.session ? { session: { ...state.session, mustChangePassword: false } } : state))
  },

  logout: async () => {
    await logoutStudentApi().catch(() => undefined)
    useSecretsStore.getState().forget()
    set({ session: null })
  },
}))
