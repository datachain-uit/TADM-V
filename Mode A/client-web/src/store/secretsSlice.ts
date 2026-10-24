import { create } from 'zustand'
import type { StudentSecrets } from '@/crypto'

interface SecretsState {
  secrets: StudentSecrets | null
  keep: (secrets: StudentSecrets) => void
  forget: () => void
}

export const useSecretsStore = create<SecretsState>((set) => ({
  secrets: null,
  keep: (secrets) => set({ secrets }),
  forget: () => set({ secrets: null }),
}))
