import { useCallback, useState } from 'react'
import type { NoticeMessage } from '@/components/Notice'

export function useActionNotice() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<NoticeMessage | null>(null)

  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ kind: 'ok', text: success })
      return true
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, message, run }
}
