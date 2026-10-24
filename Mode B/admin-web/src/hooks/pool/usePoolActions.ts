import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  approveRootService,
  createPoolService,
  deployPoolService,
  fundPoolService,
  getPoolBalanceService,
  recordFundingService,
} from '@/services/pool'
import { POOLS_KEY } from './usePools'

export function usePoolActions() {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: POOLS_KEY })

  const create = useMutation({ mutationFn: (programName: string) => createPoolService(programName), onSuccess })
  const deploy = useMutation({ mutationFn: (v: { poolId: string; initialFundingEth: string }) => deployPoolService(v.poolId, v.initialFundingEth), onSuccess })
  const fund = useMutation({ mutationFn: (v: { poolId: string; amountEth: string; sponsorAddress: string }) => fundPoolService(v.poolId, v.amountEth, v.sponsorAddress), onSuccess })
  const recordFunding = useMutation({ mutationFn: (v: { poolId: string; transactionHash: string }) => recordFundingService(v.poolId, v.transactionHash), onSuccess })
  const approveRoot = useMutation({ mutationFn: (poolId: string) => approveRootService(poolId), onSuccess })

  return {
    create: create.mutateAsync,
    deploy: deploy.mutateAsync,
    fund: fund.mutateAsync,
    recordFunding: recordFunding.mutateAsync,
    approveRoot: approveRoot.mutateAsync,
    readBalance: getPoolBalanceService,
  }
}
