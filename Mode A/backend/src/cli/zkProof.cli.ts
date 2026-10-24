import { computeCommitment, computeNullifier, computeMerkleRoot } from '../services/zkProof.service';
import { derivePublicKeyFromPrivateKey } from '../clients/ipfs/noteEncryption';
import { readJsonInput } from '../utils/jsonInput';
import { printJson } from '../utils/serviceOutput';

async function runZkProofCli(args: string[] = process.argv.slice(2)) {
  const [mode, argument] = args;

  if (mode === 'derive' && argument) {
    printJson({ publicKey: derivePublicKeyFromPrivateKey(argument) });
    return;
  }

  if (mode === 'commitment') {
    printJson({ commitment: computeCommitment(readJsonInput(argument) as any) });
    return;
  }

  if (mode === 'nullifier') {
    printJson({ nullifier: computeNullifier(readJsonInput(argument) as any) });
    return;
  }

  if (mode === 'root') {
    printJson(computeMerkleRoot((readJsonInput(argument) as any).commitments));
    return;
  }

  throw new Error(
    'Usage: npm run student:pubkey -- <studentPrivateKey>' +
      ' | npx ts-node src/cli/zkProof.cli.ts <commitment|nullifier|root> [input.json] (or JSON on stdin)',
  );
}

export { runZkProofCli };

if (require.main === module) {
  runZkProofCli().catch(require('./errorHandler').handleCliError);
}
