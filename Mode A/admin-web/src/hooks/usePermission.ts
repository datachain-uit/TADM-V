import { useAuthStore } from '@/store/authSlice'
import type { StaffRole } from '@/types/auth'

export function usePermission() {
  const role = useAuthStore((state) => state.identity?.role)
  return { role, is: (wanted: StaffRole) => role === wanted }
}
