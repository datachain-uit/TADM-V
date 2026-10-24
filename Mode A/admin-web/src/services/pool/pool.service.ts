import { adaptPools } from '@/adapters/pool'
import { approveRootApi, createPoolApi, deployPoolApi, fundPoolApi, getAllPoolsApi, getPoolBalanceApi, recordFundingApi } from '@/api/pool'
import type { FundingRecordRaw, PoolEntity } from '@/types/pool'
import { ethToWei } from '@/utils/format'

export async function getPoolsService(): Promise<PoolEntity[]> {
  return adaptPools(await getAllPoolsApi())
}

export async function createPoolService(programName: string): Promise<void> {
  await createPoolApi(programName.trim())
}

export async function deployPoolService(poolId: string, initialFundingEth: string): Promise<void> {
  await deployPoolApi(poolId, ethToWei(initialFundingEth))
}

export async function fundPoolService(poolId: string, amountEth: string, sponsorAddress: string): Promise<void> {
  await fundPoolApi(poolId, ethToWei(amountEth), sponsorAddress.trim())
}

export async function recordFundingService(poolId: string, transactionHash: string): Promise<FundingRecordRaw> {
  return recordFundingApi(poolId, transactionHash.trim())
}

export async function getPoolBalanceService(poolId: string): Promise<string> {
  return (await getPoolBalanceApi(poolId)).balanceWei
}

export async function approveRootService(poolId: string): Promise<void> {
  await approveRootApi(poolId)
}
