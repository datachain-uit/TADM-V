import { useState, type FormEvent } from 'react'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import { Field } from '@/components/Form'
import Notice from '@/components/Notice'
import { useActionNotice } from '@/hooks/useActionNotice'
import { usePools } from '@/hooks/pool'
import { useStudentActions } from '@/hooks/student'

export default function RegisterWalletForm() {
  const { pools } = usePools()
  const [poolId, setPoolId] = useState('')
  const [email, setEmail] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const { registerWallet } = useStudentActions()
  const { busy, message, run } = useActionNotice()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const ok = await run(() => registerWallet({ poolId, email, walletAddress, publicKey }), `Wallet registered for ${email}`)
    if (ok) {
      setEmail('')
      setWalletAddress('')
      setPublicKey('')
    }
  }

  return (
    <CardSection title="Register a student wallet and note public key">
      <p className="muted">The student generates both values on the student page (My keys). The note is later encrypted under this public key.</p>
      <form className="inline-form" onSubmit={submit}>
        <Field label="Scholarship pool">
          <select value={poolId} onChange={(e) => setPoolId(e.target.value)} required>
            <option value="">— select —</option>
            {pools.filter((p) => p.isDeployed).map((p) => (
              <option key={p.poolId} value={p.poolId}>{p.programName}</option>
            ))}
          </select>
        </Field>
        <Field label="Student email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Wallet address">
          <input value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="0x…" required />
        </Field>
        <Field label="Note public key">
          <input value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="0x04…" required />
        </Field>
        <Button type="submit" disabled={busy}>Register</Button>
      </form>
      <Notice message={message} />
    </CardSection>
  )
}
