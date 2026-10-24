import { Navigate, Outlet } from 'react-router-dom'
import Header from '@/components/Header'
import Sidebar from '@/components/Sidebar'
import { useAuthStore } from '@/store/authSlice'

export default function ProtectedLayout() {
  const identity = useAuthStore((state) => state.identity)
  const checked = useAuthStore((state) => state.checked)

  if (!checked) return <p className="muted center">Checking your session…</p>
  if (!identity) return <Navigate to="/auth/login" replace />

  return (
    <div className="app-shell">
      <Sidebar role={identity.role} />
      <div className="app-main">
        <Header />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
