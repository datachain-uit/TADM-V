import { useState, type FormEvent } from 'react'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import { Field } from '@/components/Form'
import Notice from '@/components/Notice'
import { useActionNotice } from '@/hooks/useActionNotice'
import { usePoolActions } from '@/hooks/pool'

export default function CreatePoolForm() {
  const [programName, setProgramName] = useState('')
  const { create } = usePoolActions()
  const { busy, message, run } = useActionNotice()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const ok = await run(() => create(programName), `Pool “${programName}” created`)
    if (ok) setProgramName('')
  }

  return (
    <CardSection title="Create a scholarship program">
      <form className="inline-form" onSubmit={submit}>
        <Field label="Program name">
          <input value={programName} onChange={(e) => setProgramName(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy}>Create pool</Button>
      </form>
      <Notice message={message} />
    </CardSection>
  )
}
