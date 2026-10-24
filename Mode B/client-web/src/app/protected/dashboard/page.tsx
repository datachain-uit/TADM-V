import { Link } from 'react-router-dom'
import Badge from '@/components/Badge'
import CardSection from '@/components/CardSection'
import DataTable from '@/components/DataTable'
import Loading from '@/components/Loading'
import PageHeader from '@/components/PageHeader'
import { useStudentOverview } from '@/hooks/student'
import { formatEth } from '@/utils/format'
import { buildScholarshipColumns } from './component/overviewColumns'

export default function DashboardPage() {
  const { overview, isLoading, error } = useStudentOverview()

  if (!overview) return <Loading isLoading={isLoading} error={error} />

  return (
    <>
      <PageHeader title="Overview" description="Your scholarship status" />
      <div className="stat-grid">
        <CardSection title="Eligibility">
          <Badge status={overview.eligibilityStatus} />
        </CardSection>
        <CardSection title="Funding">
          <Badge status={overview.financeStatus} />
          <p className="stat">{formatEth(overview.amountWei)}</p>
        </CardSection>
      </div>

      <CardSection title="Next steps">
        {!overview.isApproved && <p>Waiting for the university to approve your eligibility and funding.</p>}
        {overview.isApproved && overview.scholarships.length === 0 && (
          <p>
            You are eligible. <Link to="/protected/dashboard/keys">Generate your keys</Link> and give your wallet address and note public key to the Student Affairs Office.
          </p>
        )}
        {overview.hasScholarshipReady && (
          <p>
            Your scholarship is ready. <Link to="/protected/dashboard/withdrawal">Withdraw scholarship</Link>.
          </p>
        )}
      </CardSection>

      <CardSection title="Scholarships">
        <DataTable rows={overview.scholarships} columns={buildScholarshipColumns(overview)} rowKey={(s) => s.poolId} empty="No scholarship yet" />
      </CardSection>
    </>
  )
}
