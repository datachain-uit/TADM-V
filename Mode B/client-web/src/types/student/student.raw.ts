export interface OpenPoolRaw {
  poolId: string
  programName: string
  contractAddress: string
  chainId: string
}

export type ScholarshipStatus = 'WALLET_REGISTERED' | 'NOTE_CREATED' | 'ROOT_APPROVED' | 'WITHDRAWAL_REQUESTED' | 'WITHDRAWN'

export interface ScholarshipSummaryRaw {
  poolId: string
  walletAddress: string
  status: ScholarshipStatus
  encryptedNoteCid: string | null
}

export interface StudentOverviewRaw {
  studentId: number
  email: string
  eligibilityStatus: string
  financeStatus: string
  amountWei: string | null
  mustChangePassword: boolean
  pools: OpenPoolRaw[]
  scholarships: ScholarshipSummaryRaw[]
}
