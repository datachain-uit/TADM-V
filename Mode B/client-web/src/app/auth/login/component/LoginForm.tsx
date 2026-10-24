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
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await login(universityId.trim(), Number(studentId), password)
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
      <h1>Student sign-in</h1>
      <p className="muted">Accounts are issued by the Student Affairs Office.</p>
      <Field label="University ID">
        <input value={universityId} onChange={(e) => setUniversityId(e.target.value)} required />
      </Field>
      <Field label="Student ID">
        <input value={studentId} onChange={(e) => setStudentId(e.target.value)} inputMode="numeric" required />
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
