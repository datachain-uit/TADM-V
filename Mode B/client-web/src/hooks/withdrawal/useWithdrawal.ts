import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { NoticeMessage } from '@/components/Notice'
import type { StudentSecrets } from '@/crypto'
import { STUDENT_OVERVIEW_KEY } from '@/hooks/student'
import { withdrawScholarshipService } from '@/services/withdrawal'
import type { WithdrawalSubmitResultRaw } from '@/types/withdrawal'

export function useWithdrawal() {
  const queryClient = useQueryClient()
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<WithdrawalSubmitResultRaw | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  const withdraw = useCallback(
    async (secrets: StudentSecrets, poolId: string) => {
      setBusy(true)
      setMessage(null)
      setLog([])
      setResult(null)
      try {
        const output = await withdrawScholarshipService(secrets, poolId, (line) => setLog((lines) => [...lines, line]))
        setResult(output)
        await queryClient.invalidateQueries({ queryKey: STUDENT_OVERVIEW_KEY })
        setMessage({ kind: 'ok', text: 'Withdrawal request submitted. Waiting for the Finance Office to approve the payout.' })
      } catch (err) {
        setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      } finally {
        setBusy(false)
      }
    },
    [queryClient],
  )

  return { log, result, busy, message, withdraw }
}
