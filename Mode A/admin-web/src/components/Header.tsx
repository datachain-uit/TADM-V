import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authSlice'
import { ROLE_LABEL } from '@/utils/labels'
import Button from './Button'

export default function Header() {
  const identity = useAuthStore((state) => state.identity)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  if (!identity) return null

  return (
    <header className="topbar">
      <span>
        <strong>{identity.staffId}</strong> · {ROLE_LABEL[identity.role]}
      </span>
      <Button
        variant="secondary"
        onClick={async () => {
          await logout()
          navigate('/auth/login')
        }}
      >
        Sign out
      </Button>
    </header>
  )
}
