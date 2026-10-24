import { useState } from 'react'
import CardSection from '@/components/CardSection'
import DataTable from '@/components/DataTable'
import Loading from '@/components/Loading'
import Notice from '@/components/Notice'
import PageHeader from '@/components/PageHeader'
import { useActionNotice } from '@/hooks/useActionNotice'
import { usePermission } from '@/hooks/usePermission'
import { usePoolActions, usePools } from '@/hooks/pool'
import CreatePoolForm from './component/CreatePoolForm'
import { buildPoolColumns } from './component/poolColumns'

export default function PoolsPage() {
  const { is } = usePermission()
  const isFinance = is('FINANCE')
  const { pools, isLoading, error } = usePools()
  const { deploy, fund, recordFunding, readBalance } = usePoolActions()
  const { busy, message, run } = useActionNotice()
  const [balances, setBalances] = useState<Record<string, string>>({})

  const columns = buildPoolColumns({
    busy,
    isFinance,
    balances,
    showBalance: (p) =>
      void run(async () => {
        const balanceWei = await readBalance(p.poolId)
        setBalances((current) => ({ ...current, [p.poolId]: balanceWei }))
      }, `Balance read for ${p.programName}`),
    deploy: (p) => {
      const initialFundingEth = window.prompt(`Initial funding when deploying “${p.programName}” (ETH, may be 0)`, '0')
      if (initialFundingEth !== null) void run(() => deploy({ poolId: p.poolId, initialFundingEth }), `Deployed ${p.programName}`)
    },
    recordFunding: (p) => {
      const transactionHash = window.prompt('Hash of the transaction in which the sponsor sent ETH to the pool (0x…)')
      if (transactionHash) void run(() => recordFunding({ poolId: p.poolId, transactionHash }), 'Funding verified on-chain')
    },
    fundOnGanache: (p) => {
      const amountEth = window.prompt('Amount the sponsor funds (ETH)', '1')
      if (!amountEth) return
      const sponsorAddress = window.prompt('Sponsor wallet address — Ganache only (pre-unlocked account)')
      if (sponsorAddress) void run(() => fund({ poolId: p.poolId, amountEth, sponsorAddress }), `Funded ${amountEth} ETH`)
    },
  })

  return (
    <>
      <PageHeader
        title="Scholarship pools"
        description="On Sepolia the sponsor sends ETH from their own wallet; the Finance Office only pastes the transaction hash so the server can verify it on-chain."
      />
      {isFinance && <CreatePoolForm />}
      <CardSection>
        <Notice message={message} />
        <Loading isLoading={isLoading} error={error} />
        {!isLoading && <DataTable rows={pools} columns={columns} rowKey={(p) => p.poolId} empty="No pools yet" />}
      </CardSection>
    </>
  )
}
