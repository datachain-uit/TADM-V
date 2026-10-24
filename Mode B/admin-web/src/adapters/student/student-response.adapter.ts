import type { StudentEntity, StudentRaw } from '@/types/student'

export function adaptStudent(raw: StudentRaw): StudentEntity {
  const { hasPassword, mustChangePassword, ...rest } = raw
  return {
    ...rest,
    accountState: !hasPassword ? 'NONE' : mustChangePassword ? 'TEMPORARY' : 'ACTIVE',
    readyForScholarship: raw.eligibilityStatus === 'ELIGIBLE' && raw.financeStatus === 'APPROVED',
  }
}

export function adaptStudents(raws: StudentRaw[]): StudentEntity[] {
  return raws.map(adaptStudent)
}
