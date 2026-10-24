import { authFetcher } from '@/config/authFetcher'
import type { FundingRecordRaw, PoolRaw } from '@/types/pool'

export async function getAllPoolsApi(): Promise<PoolRaw[]> {
  return authFetcher<PoolRaw[]>('/pools', { method: 'GET' })
}

export async function createPoolApi(programName: string): Promise<void> {
  await authFetcher('/pools', { method: 'POST', data: { programName } })
}

export async function deployPoolApi(poolId: string, initialFundingWei: string): Promise<void> {
  await authFetcher(`/pools/${poolId}/deploy`, { method: 'POST', data: { initialFundingWei } })
}

export async function fundPoolApi(poolId: string, amountWei: string, sponsorAddress: string): Promise<void> {
  await authFetcher(`/pools/${poolId}/fund`, { method: 'POST', data: { amountWei, sponsorAddress } })
}

export async function recordFundingApi(poolId: string, transactionHash: string): Promise<FundingRecordRaw> {
  return authFetcher<FundingRecordRaw>(`/pools/${poolId}/fundings`, { method: 'POST', data: { transactionHash } })
}

export async function getPoolBalanceApi(poolId: string): Promise<{ balanceWei: string }> {
  return authFetcher<{ balanceWei: string }>(`/pools/${poolId}/balance`, { method: 'GET' })
}

export async function approveRootApi(poolId: string): Promise<void> {
  await authFetcher(`/pools/${poolId}/root/approve`, { method: 'POST' })
}
