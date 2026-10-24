import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authSlice'
import ChangePasswordForm from './component/ChangePasswordForm'

export default function ChangePasswordPage() {
  const session = useAuthStore((state) => state.session)
  const checked = useAuthStore((state) => state.checked)

  if (!checked) return <p className="muted center">Checking your session…</p>
  if (!session) return <Navigate to="/auth/login" replace />

  return (
    <div className="auth-page">
      <ChangePasswordForm temporary={session.mustChangePassword} />
    </div>
  )
}
