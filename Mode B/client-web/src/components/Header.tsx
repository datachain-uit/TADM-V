import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useStudentOverview } from '@/hooks/student'
import { useAuthStore } from '@/store/authSlice'
import Button from './Button'

export default function Header() {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)
  const { overview } = useStudentOverview()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  if (!session) return null

  return (
    <header className="topbar">
      <span>
        <strong>{session.studentId}</strong>
        {overview ? ` · ${overview.email}` : ''}
      </span>
      <Button
        variant="secondary"
        onClick={async () => {
          await logout()

          queryClient.clear()
          navigate('/auth/login')
        }}
      >
        Sign out
      </Button>
    </header>
  )
}
