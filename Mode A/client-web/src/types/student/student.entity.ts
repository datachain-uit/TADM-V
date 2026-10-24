import type { StudentOverviewRaw } from './student.raw'

export interface StudentOverviewEntity extends StudentOverviewRaw {
  programNames: Record<string, string>
  isApproved: boolean
  hasScholarshipReady: boolean
}
