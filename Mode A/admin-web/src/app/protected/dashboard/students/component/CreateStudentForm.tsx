import { useState, type FormEvent } from 'react'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import { Field } from '@/components/Form'
import Notice from '@/components/Notice'
import { useActionNotice } from '@/hooks/useActionNotice'
import { useStudentActions } from '@/hooks/student'

export default function CreateStudentForm() {
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const { create } = useStudentActions()
  const { busy, message, run } = useActionNotice()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const ok = await run(() => create({ studentId: Number(studentId), email }), `Student record ${studentId} created`)
    if (ok) {
      setStudentId('')
      setEmail('')
    }
  }

  return (
    <CardSection title="Create a student record">
      <form className="inline-form" onSubmit={submit}>
        <Field label="Student ID">
          <input value={studentId} onChange={(e) => setStudentId(e.target.value)} inputMode="numeric" required />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy}>Create</Button>
      </form>
      <Notice message={message} />
    </CardSection>
  )
}
