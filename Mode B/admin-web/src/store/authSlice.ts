import { create } from 'zustand'
import { getStaffMeApi, loginStaffApi, logoutStaffApi } from '@/api/auth'
import type { StaffIdentity } from '@/types/auth'

interface AuthState {
  identity: StaffIdentity | null
  checked: boolean
  restore: () => Promise<void>
  login: (universityId: string, staffId: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  identity: null,
  checked: false,

  restore: async () => {
    const identity = await getStaffMeApi().catch(() => null)
    set((state) => (state.checked ? state : { identity, checked: true }))
  },

  login: async (universityId, staffId, password) => {
    const identity = await loginStaffApi(universityId, staffId, password)
    set({ identity, checked: true })
  },

  logout: async () => {
    await logoutStaffApi().catch(() => undefined)
    set({ identity: null })
  },
}))
