import { decryptStudentNote } from '../clients/ipfs/encryptedNoteStorage';
import { emitJson } from '../utils/serviceOutput';

async function runDecryptStudentNoteCli(args: string[] = process.argv.slice(2)) {
  const [cid, studentPrivateKey, outputPath] = args;

  if (!cid || !studentPrivateKey) {
    throw new Error('Usage: npm run note:decrypt -- <cid> <studentPrivateKey> [outputJsonPath]');
  }

  emitJson(outputPath, await decryptStudentNote(cid, studentPrivateKey));
}

export { runDecryptStudentNoteCli };

if (require.main === module) {
  runDecryptStudentNoteCli().catch(require('./errorHandler').handleCliError);
}
