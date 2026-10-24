import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/Button'
import { Field } from '@/components/Form'
import Notice, { type NoticeMessage } from '@/components/Notice'
import { useAuthStore } from '@/store/authSlice'

export default function ChangePasswordForm({ temporary }: { temporary: boolean }) {
  const changePassword = useAuthStore((state) => state.changePassword)
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (next !== confirm) {
      setMessage({ kind: 'error', text: 'The two new passwords do not match' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await changePassword(current, next)
      navigate('/protected/dashboard')
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>Change password</h1>
      <p className="muted">
        {temporary ? 'You are using a temporary password issued by the university — change it before continuing.' : 'Change your account password.'}
      </p>
      <Field label="Current password">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="New password" hint="At least 8 characters">
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
      </Field>
      <Field label="Confirm new password">
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <Notice message={message} />
      <Button type="submit" disabled={busy}>Change password</Button>
    </form>
  )
}
