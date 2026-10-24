import { useState } from 'react'
import { Wallet, isAddress } from 'ethers'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import { Field } from '@/components/Form'
import Loading from '@/components/Loading'
import Notice, { type NoticeMessage } from '@/components/Notice'
import PageHeader from '@/components/PageHeader'
import { MIN_BACKUP_PASSWORD_LENGTH, downloadJson, encryptBackup, generateNoteKeyPair, type StudentSecrets } from '@/crypto'
import { useStudentOverview } from '@/hooks/student'
import { useSecretsStore } from '@/store/secretsSlice'

type WalletSource = 'new' | 'own'

export default function KeysPage() {
  const { overview, isLoading, error } = useStudentOverview()
  const keep = useSecretsStore((state) => state.keep)

  const [source, setSource] = useState<WalletSource>('new')
  const [ownAddress, setOwnAddress] = useState('')
  const [secrets, setSecrets] = useState<StudentSecrets | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [backedUp, setBackedUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  if (!overview) return <Loading isLoading={isLoading} error={error} />

  async function step(action: () => Promise<void> | void) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const generateKeys = () =>
    step(() => {
      if (source === 'own' && !isAddress(ownAddress)) throw new Error('Enter a valid wallet address')
      const wallet = source === 'new' ? Wallet.createRandom() : null
      const noteKeys = generateNoteKeyPair()
      setSecrets({
        studentId: overview.studentId,
        walletAddress: wallet ? wallet.address : ownAddress,
        walletPrivateKey: wallet ? wallet.privateKey : null,
        notePrivateKey: noteKeys.privateKey,
        notePublicKey: noteKeys.publicKey,
      })
      setBackedUp(false)
    })

  const backup = () =>
    step(async () => {
      if (!secrets) return
      if (password !== confirm) throw new Error('The two backup-file passwords do not match')
      const file = await encryptBackup(secrets, password)
      downloadJson(`tadmv-keys-${secrets.studentId}.json`, file)
      keep(secrets)
      setBackedUp(true)
      setPassword('')
      setConfirm('')
    })

  return (
    <>
      <PageHeader
        title="My keys"
        description="Your note key is generated on this device. The university only needs your wallet address and your note public key; the private keys stay in the backup file you download."
      />
      <Notice message={message} />

      <CardSection title="1. Generate keys on this device">
        <div className="inline-form">
          <Field label="Payout wallet">
            <select value={source} onChange={(e) => setSource(e.target.value as WalletSource)} disabled={Boolean(secrets)}>
              <option value="new">Create a new wallet in the page</option>
              <option value="own">Use my own wallet address</option>
            </select>
          </Field>
          {source === 'own' && (
            <Field label="Wallet address">
              <input value={ownAddress} onChange={(e) => setOwnAddress(e.target.value.trim())} placeholder="0x…" disabled={Boolean(secrets)} />
            </Field>
          )}
          <Button onClick={generateKeys} disabled={busy || Boolean(secrets)}>Generate keys</Button>
        </div>
      </CardSection>

      {secrets && (
        <CardSection title="2. Download the key backup file (required)">
          <p className="notice notice-warn">
            This file holds your note key{secrets.walletPrivateKey ? ' and your wallet key' : ''}. If you lose the file or forget its password, nobody can recover
            them — not even the university — and you cannot open your scholarship note.
          </p>
          <div className="inline-form">
            <Field label="Backup file password" hint={`At least ${MIN_BACKUP_PASSWORD_LENGTH} characters, different from your account password`}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Re-enter password">
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button onClick={backup} disabled={busy || !password}>Download backup file</Button>
          </div>
          {backedUp && <p className="notice notice-ok">Backup file downloaded. Keep it safe.</p>}
        </CardSection>
      )}

      {secrets && backedUp && (
        <CardSection title="3. Give these two public values to the Student Affairs Office">
          <dl className="kv">
            <dt>Wallet address</dt>
            <dd><code>{secrets.walletAddress}</code></dd>
            <dt>Note public key</dt>
            <dd><code className="wrap">{secrets.notePublicKey}</code></dd>
          </dl>
          <p className="muted">The Student Affairs Office registers them for your scholarship program; your note is then encrypted under this public key.</p>
        </CardSection>
      )}
    </>
  )
}
