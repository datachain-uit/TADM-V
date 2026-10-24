import { useState } from 'react'
import Badge from '@/components/Badge'
import Button from '@/components/Button'
import CardSection from '@/components/CardSection'
import { Field } from '@/components/Form'
import Loading from '@/components/Loading'
import Notice from '@/components/Notice'
import PageHeader from '@/components/PageHeader'
import { useStudentOverview } from '@/hooks/student'
import { useWithdrawal } from '@/hooks/withdrawal'
import { useSecretsStore } from '@/store/secretsSlice'
import { formatEth, shortHex } from '@/utils/format'
import ProgressLog from './component/ProgressLog'
import UnlockBackup from './component/UnlockBackup'

export default function WithdrawalPage() {
  const { overview, isLoading, error } = useStudentOverview()
  const secrets = useSecretsStore((state) => state.secrets)
  const forget = useSecretsStore((state) => state.forget)
  const { log, result, busy, message, withdraw } = useWithdrawal()
  const [poolId, setPoolId] = useState('')

  if (!overview) return <Loading isLoading={isLoading} error={error} />

  const scholarship = overview.scholarships.find((s) => s.poolId === poolId)

  return (
    <>
      <PageHeader
        title="Withdraw scholarship"
        description="Your note key decrypts the note on this device. The decrypted note is then sent to the university backend, which generates and verifies the Halo2 proof."
      />
      <Notice message={message} />

      {!secrets && <UnlockBackup studentId={overview.studentId} />}

      {secrets && (
        <CardSection title="Choose the scholarship">
          <div className="inline-form">
            <Field label="Scholarship program">
              <select value={poolId} onChange={(e) => setPoolId(e.target.value)} disabled={busy}>
                <option value="">— select —</option>
                {overview.scholarships.map((s) => (
                  <option key={s.poolId} value={s.poolId}>{overview.programNames[s.poolId] ?? shortHex(s.poolId)}</option>
                ))}
              </select>
            </Field>
          </div>
          {scholarship && (
            <p>
              Recipient wallet <code>{scholarship.walletAddress}</code> · amount {formatEth(overview.amountWei)} · <Badge status={scholarship.status} />
            </p>
          )}
          <div className="row-actions">
            <Button onClick={() => withdraw(secrets, poolId)} disabled={busy || scholarship?.status !== 'ROOT_APPROVED'}>
              {busy ? 'Working…' : 'Decrypt the note and request the payout'}
            </Button>
            <Button variant="secondary" onClick={forget} disabled={busy}>Lock (remove keys from the page)</Button>
          </div>
          {scholarship && scholarship.status !== 'ROOT_APPROVED' && (
            <p className="muted">You can withdraw once the status is “Ready to withdraw” (the university has issued the scholarship and approved the root).</p>
          )}
        </CardSection>
      )}

      <ProgressLog log={log} result={result} />
    </>
  )
}
