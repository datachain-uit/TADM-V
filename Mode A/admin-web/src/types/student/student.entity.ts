import type { StudentRaw } from './student.raw'

export type AccountState = 'NONE' | 'TEMPORARY' | 'ACTIVE'

export interface StudentEntity extends Omit<StudentRaw, 'hasPassword' | 'mustChangePassword'> {
  accountState: AccountState
  readyForScholarship: boolean
}
