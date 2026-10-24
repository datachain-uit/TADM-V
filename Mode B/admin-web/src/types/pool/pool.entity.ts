import type { PoolRaw } from './pool.raw'

export interface PoolEntity extends PoolRaw {
  isDeployed: boolean
  canDeploy: boolean
}
