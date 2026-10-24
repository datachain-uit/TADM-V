import { getIpfsClient } from './ipfsClient';
import { encryptNoteForStudent, decryptNoteWithStudentPrivateKey } from './noteEncryption';

async function uploadToIpfs(studentData: any, studentPublicKeyHex: string): Promise<string> {
  const encryptedNote = encryptNoteForStudent(studentData, studentPublicKeyHex);
  const result = await getIpfsClient().add(JSON.stringify(encryptedNote));

  return result.cid.toString();
}

async function readEncryptedNote(cid: string) {
  const chunks: Buffer[] = [];

  for await (const chunk of getIpfsClient().cat(cid)) {
    chunks.push(Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function getStudentFromIpfs(cid: string, studentPrivateKeyHex: string) {
  const encryptedNote = await readEncryptedNote(cid);

  return decryptNoteWithStudentPrivateKey(encryptedNote, studentPrivateKeyHex);
}

async function decryptStudentNote(cid: string, privateKey: string) {
  const note = await getStudentFromIpfs(cid, privateKey);
  if (!note?.student_id || !note?.amount || !note?.rho) {
    throw new Error('Decrypted note has an invalid structure');
  }
  return { cid, note };
}

export { uploadToIpfs, readEncryptedNote, getStudentFromIpfs, decryptStudentNote };
