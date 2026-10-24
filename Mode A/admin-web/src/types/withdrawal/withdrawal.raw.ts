export type WithdrawalStatus = 'PENDING_APPROVAL' | 'REJECTED' | 'EXECUTED' | 'EXECUTION_FAILED'

export interface WithdrawalRaw {
  requestId: string
  poolId: string
  status: WithdrawalStatus
  amountWei: string
  recipient: string
  transactionHash: string | null
  createdAt: string
}
