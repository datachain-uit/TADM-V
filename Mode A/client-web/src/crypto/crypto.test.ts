import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/backend-note.json'
import { decryptBackup, decryptNote, encryptBackup, generateNoteKeyPair, notePublicKeyOf, type StudentSecrets } from '.'

describe('note crypto matches the backend', () => {
  it('derives the same ECDH public key as the backend', () => {
    expect(notePublicKeyOf(fixture.notePrivateKey)).toBe(fixture.notePublicKey)
    expect(notePublicKeyOf(fixture.otherPrivateKey)).toBe(fixture.otherPublicKey)
  })

  it('decrypts a note the backend encrypted', async () => {
    const note = await decryptNote(fixture.envelope, fixture.notePrivateKey)
    expect(note).toEqual(fixture.note)
  })

  it('refuses another student’s key', async () => {
    await expect(decryptNote(fixture.envelope, fixture.otherPrivateKey)).rejects.toThrow(/wrong note key/)
  })

  it('refuses a tampered envelope', async () => {
    const flipped = fixture.envelope.ciphertext.slice(0, -2) + (fixture.envelope.ciphertext.endsWith('00') ? '01' : '00')
    await expect(decryptNote({ ...fixture.envelope, ciphertext: flipped }, fixture.notePrivateKey)).rejects.toThrow()
  })

  it('generates fresh uncompressed key pairs', () => {
    const first = generateNoteKeyPair()
    const second = generateNoteKeyPair()
    expect(first.publicKey).toMatch(/^0x04[0-9a-f]{128}$/)
    expect(first.privateKey).not.toBe(second.privateKey)
  })
})

describe('key backup file', () => {
  const secrets: StudentSecrets = {
    studentId: 24561001,
    walletAddress: '0x' + '66'.repeat(20),
    walletPrivateKey: null,
    notePrivateKey: fixture.notePrivateKey,
    notePublicKey: fixture.notePublicKey,
  }

  it('round-trips with the right password and hides the secrets', async () => {
    const file = await encryptBackup(secrets, 'correct horse battery')
    const text = JSON.stringify(file)
    expect(text).not.toContain(secrets.notePrivateKey.slice(2))
    expect(await decryptBackup(file, 'correct horse battery')).toEqual(secrets)
  }, 30_000)

  it('rejects a wrong password and a short one', async () => {
    const file = await encryptBackup(secrets, 'correct horse battery')
    await expect(decryptBackup(file, 'wrong horse battery')).rejects.toThrow(/Wrong backup file password/)
    await expect(encryptBackup(secrets, 'short')).rejects.toThrow(/at least/)
  }, 30_000)
})
