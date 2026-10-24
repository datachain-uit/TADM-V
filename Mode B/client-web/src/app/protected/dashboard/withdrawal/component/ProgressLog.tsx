import CardSection from '@/components/CardSection'
import type { WithdrawalSubmitResultRaw } from '@/types/withdrawal'
import { shortHex } from '@/utils/format'

export default function ProgressLog({ log, result }: { log: string[]; result: WithdrawalSubmitResultRaw | null }) {
  if (log.length === 0) return null

  return (
    <CardSection title="Progress">
      <ol className="log">
        {log.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
      {result && (
        <dl className="kv">
          <dt>Request</dt>
          <dd><code>{result.id}</code></dd>
          <dt>Nullifier</dt>
          <dd><code title={result.nullifier}>{shortHex(result.nullifier, 10)}</code></dd>
          {result.localVerificationPassed !== undefined && (
            <>
              <dt>Off-chain verification</dt>
              <dd>{result.localVerificationPassed ? 'passed' : 'failed'}{result.verificationMs !== undefined ? ` (${Math.round(result.verificationMs)} ms)` : ''}</dd>
            </>
          )}
          {result.verifyRecordTxHash && (
            <>
              <dt>On-chain verification</dt>
              <dd>
                <code title={result.verifyRecordTxHash}>{shortHex(result.verifyRecordTxHash, 10)}</code>
                {result.verifyRecordGas !== undefined ? ` · ${result.verifyRecordGas.toLocaleString('en-US')} gas` : ''}
              </dd>
            </>
          )}
        </dl>
      )}
    </CardSection>
  )
}
