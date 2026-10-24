import type { StudentOverviewEntity, StudentOverviewRaw } from '@/types/student'

export function adaptStudentOverview(raw: StudentOverviewRaw): StudentOverviewEntity {
  return {
    ...raw,
    programNames: Object.fromEntries(raw.pools.map((pool) => [pool.poolId, pool.programName])),
    isApproved: raw.eligibilityStatus === 'ELIGIBLE' && raw.financeStatus === 'APPROVED',
    hasScholarshipReady: raw.scholarships.some((s) => s.status === 'ROOT_APPROVED'),
  }
}
