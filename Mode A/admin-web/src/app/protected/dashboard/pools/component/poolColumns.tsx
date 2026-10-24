import Badge from '@/components/Badge'
import Button from '@/components/Button'
import type { Column } from '@/components/DataTable'
import type { PoolEntity } from '@/types/pool'
import { formatEth, shortHex } from '@/utils/format'

export interface PoolRowActions {
  busy: boolean
  isFinance: boolean
  balances: Record<string, string>
  showBalance: (pool: PoolEntity) => void
  deploy: (pool: PoolEntity) => void
  recordFunding: (pool: PoolEntity) => void
  fundOnGanache: (pool: PoolEntity) => void
}

export function buildPoolColumns(actions: PoolRowActions): Column<PoolEntity>[] {
  const { busy, isFinance, balances } = actions
  return [
    { header: 'Program', render: (p) => p.programName },
    { header: 'Status', render: (p) => <Badge status={p.status} /> },
    { header: 'Contract', render: (p) => <code title={p.contractAddress ?? ''}>{shortHex(p.contractAddress)}</code> },
    { header: 'Chain', render: (p) => p.chainId ?? '—' },
    { header: 'Balance', render: (p) => (balances[p.poolId] ? formatEth(balances[p.poolId]) : '—') },
    {
      header: 'Actions',
      render: (p) => (
        <div className="row-actions">
          {p.isDeployed && <Button variant="secondary" disabled={busy} onClick={() => actions.showBalance(p)}>Balance</Button>}
          {isFinance && p.canDeploy && <Button disabled={busy} onClick={() => actions.deploy(p)}>Deploy</Button>}
          {isFinance && p.isDeployed && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => actions.recordFunding(p)}>Record funding</Button>
              <Button variant="secondary" disabled={busy} onClick={() => actions.fundOnGanache(p)}>Fund (Ganache)</Button>
            </>
          )}
        </div>
      ),
    },
  ]
}
