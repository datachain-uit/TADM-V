import { useState } from 'react'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import { Field } from '@/components/Form'
import Notice, { type NoticeMessage } from '@/components/Notice'
import { decryptBackup, type KeyBackupFile } from '@/crypto'
import { useSecretsStore } from '@/store/secretsSlice'

export default function UnlockBackup({ studentId }: { studentId: number }) {
  const keep = useSecretsStore((state) => state.keep)
  const [file, setFile] = useState<KeyBackupFile | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  async function pick(selected: File | undefined) {
    setMessage(null)
    if (!selected) return
    try {
      setFile(JSON.parse(await selected.text()))
    } catch {
      setMessage({ kind: 'error', text: 'The file could not be read' })
    }
  }

  async function unlock() {
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const secrets = await decryptBackup(file, password)
      if (secrets.studentId !== studentId) throw new Error(`This file belongs to student ${secrets.studentId}, not to you`)
      keep(secrets)
      setPassword('')
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardSection title="Open the key backup file">
      <div className="inline-form">
        <Field label="Backup file (.json)">
          <input type="file" accept="application/json,.json" onChange={(e) => pick(e.target.files?.[0])} />
        </Field>
        <Field label="File password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button onClick={unlock} disabled={busy || !file || !password}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
      </div>
      <Notice message={message} />
    </CardSection>
  )
}
