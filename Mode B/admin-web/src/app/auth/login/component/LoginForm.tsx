import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/Button'
import { Field } from '@/components/Form'
import Notice, { type NoticeMessage } from '@/components/Notice'
import { useAuthStore } from '@/store/authSlice'
import { getRememberedUniversityId, rememberUniversityId } from '@/utils/storage'

export default function LoginForm() {
  const login = useAuthStore((state) => state.login)
  const navigate = useNavigate()
  const [universityId, setUniversityId] = useState(getRememberedUniversityId)
  const [staffId, setStaffId] = useState('CTSV-01')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await login(universityId.trim(), staffId.trim(), password)
      rememberUniversityId(universityId.trim())
      navigate('/protected/dashboard')
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>Staff sign-in</h1>
      <p className="muted">Student Affairs Office · Finance Office</p>
      <Field label="University ID" hint="universityId issued by the administrator when the university was created">
        <input value={universityId} onChange={(e) => setUniversityId(e.target.value)} required />
      </Field>
      <Field label="Staff ID">
        <input value={staffId} onChange={(e) => setStaffId(e.target.value)} required />
      </Field>
      <Field label="Password">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Notice message={message} />
      <Button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
