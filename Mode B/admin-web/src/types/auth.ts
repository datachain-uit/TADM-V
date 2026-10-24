export type StaffRole = 'STUDENT_AFFAIRS' | 'FINANCE'

export interface StaffIdentity {
  universityId: string
  staffId: string
  role: StaffRole
  roleLabel?: string
}

export type Decision = 'approve' | 'reject'
