import crypto from 'crypto';
import { runProver } from '../prover/halo2ProverClient';

const ENCRYPTED_NOTE_VERSION = 'ecdh-secp256k1-aes-256-gcm-v1';

const HKDF_CONTEXT = 'scholarship-note-encryption-v1';

function cleanHex(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function deriveAesKey(sharedSecret: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.from(HKDF_CONTEXT), 32));
}

function derivePublicKeyFromPrivateKey(privateKeyHex: string): string {
  const privateKey = Buffer.from(cleanHex(privateKeyHex), 'hex');

  if (privateKey.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }

  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);

  return '0x' + ecdh.getPublicKey(undefined, 'uncompressed').toString('hex');
}

function generateRandomRho(): string {
  const result = runProver('rho', {});

  return BigInt(String(result.rho)).toString(10);
}

function createStudentNote(studentId: number, amountWei: string, rho?: string) {
  if (!/^\d+$/.test(amountWei)) {
    throw new Error('amountWei must be a decimal integer string');
  }

  if (BigInt(amountWei) <= 0n) {
    throw new Error('amountWei must be greater than zero');
  }

  if (rho !== undefined && !/^\d+$/.test(String(rho))) {
    throw new Error('rho must be a decimal integer string when supplied');
  }

  return {
    student_id: studentId,
    amount: amountWei,
    rho: rho !== undefined ? String(rho) : generateRandomRho(),
  };
}

function encryptNoteForStudent(note: any, studentPublicKeyHex: string) {
  const studentPublicKey = Buffer.from(cleanHex(studentPublicKeyHex), 'hex');

  if (studentPublicKey.length !== 65 || studentPublicKey[0] !== 4) {
    throw new Error('Student public key must be a 65-byte uncompressed key starting with 0x04');
  }

  const ephemeral = crypto.createECDH('secp256k1');
  ephemeral.generateKeys();

  const aesKey = deriveAesKey(ephemeral.computeSecret(studentPublicKey));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const plaintext = Buffer.from(JSON.stringify(note), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: ENCRYPTED_NOTE_VERSION,
    ephemeralPublicKey: '0x' + ephemeral.getPublicKey(undefined, 'uncompressed').toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

function decryptNoteWithStudentPrivateKey(encryptedNote: any, studentPrivateKeyHex: string) {
  if (encryptedNote.version !== ENCRYPTED_NOTE_VERSION) {
    throw new Error('Unsupported encrypted note version');
  }

  const privateKey = Buffer.from(cleanHex(studentPrivateKeyHex), 'hex');

  if (privateKey.length !== 32) {
    throw new Error('Student private key must be 32 bytes');
  }

  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);

  const aesKey = deriveAesKey(ecdh.computeSecret(Buffer.from(cleanHex(encryptedNote.ephemeralPublicKey), 'hex')));
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(encryptedNote.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encryptedNote.authTag, 'hex'));

  const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedNote.ciphertext, 'hex')), decipher.final()]);

  return JSON.parse(plaintext.toString('utf8'));
}

export {
  ENCRYPTED_NOTE_VERSION,
  createStudentNote,
  generateRandomRho,
  derivePublicKeyFromPrivateKey,
  encryptNoteForStudent,
  decryptNoteWithStudentPrivateKey,
};
