import { getEncryptedNoteApi, submitWithdrawalApi } from '@/api/withdrawal'
import { decryptNote, type StudentSecrets } from '@/crypto'
import type { WithdrawalSubmitResultRaw } from '@/types/withdrawal'
import { formatEth } from '@/utils/format'

export async function withdrawScholarshipService(
  secrets: StudentSecrets,
  poolId: string,
  onProgress: (line: string) => void,
): Promise<WithdrawalSubmitResultRaw> {
  onProgress('Fetching the encrypted note from IPFS through the university…')
  const { cid, envelope } = await getEncryptedNoteApi(poolId)

  onProgress('Decrypting the note on your device with your note key…')
  const note = await decryptNote(envelope, secrets.notePrivateKey)
  onProgress(`Note opened: amount ${formatEth(note.amount)}.`)

  onProgress('Sending the note to the university backend, which builds the witness and generates the Halo2 proof…')
  const result = await submitWithdrawalApi({ cid, note })
  onProgress(`Withdrawal request ${result.id} created with status ${result.status}.`)

  return result
}
