import type { PoolEntity, PoolRaw } from '@/types/pool'

export function adaptPool(raw: PoolRaw): PoolEntity {
  return {
    ...raw,
    isDeployed: raw.status === 'DEPLOYED',
    canDeploy: raw.status === 'PENDING_DEPLOYMENT' || raw.status === 'DEPLOYMENT_FAILED',
  }
}

export function adaptPools(raws: PoolRaw[]): PoolEntity[] {
  return raws.map(adaptPool)
}
