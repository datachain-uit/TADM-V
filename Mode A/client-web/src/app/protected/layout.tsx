import { Navigate, Outlet } from 'react-router-dom'
import Header from '@/components/Header'
import Sidebar from '@/components/Sidebar'
import { useAuthStore } from '@/store/authSlice'

export default function ProtectedLayout() {
  const session = useAuthStore((state) => state.session)
  const checked = useAuthStore((state) => state.checked)

  if (!checked) return <p className="muted center">Checking your session…</p>
  if (!session) return <Navigate to="/auth/login" replace />
  if (session.mustChangePassword) return <Navigate to="/auth/change-password" replace />

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Header />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
