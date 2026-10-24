import Badge from '@/components/Badge'
import type { Column } from '@/components/DataTable'
import type { ScholarshipSummaryRaw, StudentOverviewEntity } from '@/types/student'
import { shortHex } from '@/utils/format'

export function buildScholarshipColumns(overview: StudentOverviewEntity): Column<ScholarshipSummaryRaw>[] {
  return [
    { header: 'Program', render: (s) => overview.programNames[s.poolId] ?? shortHex(s.poolId) },
    { header: 'Recipient wallet', render: (s) => <code title={s.walletAddress}>{shortHex(s.walletAddress)}</code> },
    { header: 'Status', render: (s) => <Badge status={s.status} /> },
  ]
}
