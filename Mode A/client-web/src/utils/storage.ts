const UNIVERSITY_ID_KEY = 'tadmv.client.universityId'

export function getRememberedUniversityId(): string {
  try {
    return localStorage.getItem(UNIVERSITY_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberUniversityId(universityId: string): void {
  try {
    localStorage.setItem(UNIVERSITY_ID_KEY, universityId)
  } catch {
    return
  }
}
