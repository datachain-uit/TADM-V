export interface StudentSecrets {
  studentId: number
  walletAddress: string
  walletPrivateKey: string | null
  notePrivateKey: string
  notePublicKey: string
}

export interface KeyBackupFile {
  format: 'tadmv-key-backup-v1'
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  ciphertext: string
  label: { studentId: number; walletAddress: string }
}

const ITERATIONS = 600_000
export const MIN_BACKUP_PASSWORD_LENGTH = 10

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

export async function encryptBackup(secrets: StudentSecrets, password: string): Promise<KeyBackupFile> {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error(`Backup file password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters`)
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS, 'encrypt')
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(secrets)))

  return {
    format: 'tadmv-key-backup-v1',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    label: { studentId: secrets.studentId, walletAddress: secrets.walletAddress },
  }
}

export async function decryptBackup(file: KeyBackupFile, password: string): Promise<StudentSecrets> {
  if (file?.format !== 'tadmv-key-backup-v1') {
    throw new Error('Not a TADM-V key backup file')
  }
  const key = await deriveKey(password, fromBase64(file.kdf.salt), file.kdf.iterations, 'decrypt')
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.cipher.iv) }, key, fromBase64(file.ciphertext))
    return JSON.parse(new TextDecoder().decode(plaintext)) as StudentSecrets
  } catch {
    throw new Error('Wrong backup file password, or the file has been modified')
  }
}

export function downloadJson(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
