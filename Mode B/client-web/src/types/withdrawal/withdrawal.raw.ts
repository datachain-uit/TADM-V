import type { EncryptedNoteEnvelope, StudentNote } from '@/crypto'

export interface EncryptedNoteRaw {
  cid: string
  envelope: EncryptedNoteEnvelope
}

export interface WithdrawalSubmission {
  cid: string
  note: StudentNote
}

export interface WithdrawalSubmitResultRaw {
  id: string
  scholarshipId: string
  poolId: string
  recipient: string
  amountWei: string
  root: string
  nullifier: string
  status: string
  createdAt: string
  localVerificationPassed?: boolean
  verificationMs?: number
  verifierChecked?: boolean
  verifyRecordTxHash?: string
  verifyRecordGas?: number
  calldataBytes?: number
}
