import type { StaffRole } from '@/types/auth'

export const ROLE_LABEL: Record<StaffRole, string> = {
  STUDENT_AFFAIRS: 'Student Affairs Office',
  FINANCE: 'Finance Office',
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  ELIGIBLE: 'Eligible',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PENDING_DEPLOYMENT: 'Not deployed',
  DEPLOYING: 'Deploying',
  DEPLOYED: 'Deployed',
  DEPLOYMENT_FAILED: 'Deployment failed',
  PENDING_APPROVAL: 'Pending',
  EXECUTED: 'Paid out',
  EXECUTION_FAILED: 'Payout failed',
}

export const ACCOUNT_LABEL = {
  NONE: 'none',
  TEMPORARY: 'temporary password',
  ACTIVE: 'active',
} as const
