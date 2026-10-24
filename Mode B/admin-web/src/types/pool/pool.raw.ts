export type PoolStatus = 'PENDING_DEPLOYMENT' | 'DEPLOYING' | 'DEPLOYED' | 'DEPLOYMENT_FAILED'

export interface PoolRaw {
  poolId: string
  programName: string
  status: PoolStatus
  universityAddress: string
  contractAddress: string | null
  chainId: string | null
  denominationWei: string | null
  currentRoot: string | null
}

export interface FundingRecordRaw {
  sponsorAddress?: string
  sponsor?: string
  amountWei: string
  transactionHash: string
  balanceWei: string
}
