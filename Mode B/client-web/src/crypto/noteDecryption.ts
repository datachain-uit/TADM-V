import { SigningKey, getBytes } from 'ethers'

export const ENCRYPTED_NOTE_VERSION = 'ecdh-secp256k1-aes-256-gcm-v1'
const HKDF_INFO = 'scholarship-note-encryption-v1'

export interface EncryptedNoteEnvelope {
  version: string
  ephemeralPublicKey: string
  iv: string
  authTag: string
  ciphertext: string
}

export interface StudentNote {
  student_id: number
  amount: string
  rho: string
}

function withPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : `0x${hex}`
}

function sharedSecretX(privateKey: string, otherPublicKey: string): Uint8Array {
  const point = getBytes(new SigningKey(privateKey).computeSharedSecret(withPrefix(otherPublicKey)))
  if (point.length === 65 && point[0] === 4) return point.slice(1, 33)
  throw new Error('Unexpected ECDH shared secret format')
}

async function deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(HKDF_INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
}

export async function decryptNote(envelope: EncryptedNoteEnvelope, notePrivateKey: string): Promise<StudentNote> {
  if (envelope.version !== ENCRYPTED_NOTE_VERSION) {
    throw new Error('Unsupported encrypted note version')
  }

  const key = await deriveAesKey(sharedSecretX(notePrivateKey, envelope.ephemeralPublicKey))
  const ciphertext = getBytes(withPrefix(envelope.ciphertext))
  const authTag = getBytes(withPrefix(envelope.authTag))

  const sealed = new Uint8Array(ciphertext.length + authTag.length)
  sealed.set(ciphertext)
  sealed.set(authTag, ciphertext.length)

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: getBytes(withPrefix(envelope.iv)) }, key, sealed)
  } catch {
    throw new Error('Cannot open the note: wrong note key or damaged envelope')
  }

  const note = JSON.parse(new TextDecoder().decode(plaintext))
  return { student_id: Number(note.student_id), amount: String(note.amount), rho: String(note.rho) }
}
