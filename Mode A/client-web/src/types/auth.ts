export interface StudentIdentity {
  universityId: string
  studentId: number
  mustChangePassword: boolean
}

export interface StudentSession {
  studentId: number
  mustChangePassword: boolean
}
