export interface StudentRaw {
  studentId: number
  email: string
  eligibilityStatus: 'PENDING' | 'ELIGIBLE' | 'REJECTED'
  financeStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  amountWei: string | null
  hasPassword: boolean
  mustChangePassword: boolean
}
