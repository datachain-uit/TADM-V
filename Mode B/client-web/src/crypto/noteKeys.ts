import { SigningKey, Wallet } from 'ethers'

export interface NoteKeyPair {
  privateKey: string
  publicKey: string
}

export function generateNoteKeyPair(): NoteKeyPair {
  const privateKey = Wallet.createRandom().privateKey
  return { privateKey, publicKey: notePublicKeyOf(privateKey) }
}

export function notePublicKeyOf(privateKey: string): string {
  return new SigningKey(privateKey).publicKey
}
