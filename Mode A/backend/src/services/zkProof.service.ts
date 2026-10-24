import { runProver } from '../clients/prover/halo2ProverClient';
import { normalizeBytes32 } from '../utils/bytes32';

type StudentNote = {
  student_id: number;
  amount: string;
  rho: string;
};

function computeCommitment(note: StudentNote): string {
  return normalizeBytes32(runProver('commitment', note).commitment);
}

function computeNullifier(note: StudentNote): string {
  if (!note || note.student_id === undefined || note.amount === undefined || note.rho === undefined) {
    throw new Error('Invalid decrypted note');
  }
  return normalizeBytes32(runProver('nullifier', note).nullifier);
}

function computeMerkleRoot(commitments: string[]) {
  if (commitments.length === 0) {
    throw new Error('Cannot compute root from empty commitments');
  }
  const result = runProver('root', { commitments: commitments.map(normalizeBytes32) });
  return {
    root: normalizeBytes32(result.root),
    leafCount: Number(result.leaf_count),
    nodes: result.nodes,
    zeros: result.zeros,
  };
}

function verifyProofOffChain(
  proof: string,
  rootHex: string,
  nullifierHex: string,
  amountHex: string,
  recipientHex: string,
) {
  const result = runProver('verify', {
    proof,
    root: normalizeBytes32(rootHex),
    nullifier: normalizeBytes32(nullifierHex),
    amount: normalizeBytes32(amountHex),
    recipient: recipientHex,
  });

  if (result.verified !== true) {
    throw new Error('Off-chain verification did not return verified=true');
  }

  console.error('OFF-CHAIN VERIFY PASSED - verify_ms:', result.verify_ms);

  return {
    verified: true,
    setupMs: Number(result.setup_ms),
    verifyMs: Number(result.verify_ms),
  };
}

function generateStudentFile(
  student: any,
  commitments: string[],
  merkleIndex: number,
  expectedRoot: string,
  recipient: string,
  storedPath?: {
    siblings: string[];
    directions: boolean[];
  } | null,
) {
  if (!student || student.student_id === undefined || student.amount === undefined || student.rho === undefined) {
    throw new Error('Invalid decrypted note');
  }

  if (!Number.isInteger(merkleIndex) || merkleIndex < 0) {
    throw new Error('Invalid Merkle index');
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(String(recipient))) {
    throw new Error('Invalid recipient wallet address');
  }

  const hasStoredPath =
    Boolean(storedPath) && Array.isArray(storedPath?.siblings) && (storedPath?.siblings.length || 0) > 0;

  if (!hasStoredPath && commitments.length === 0) {
    throw new Error('Commitment list is empty');
  }

  const proverInput = hasStoredPath
    ? {
        ...student,
        recipient,
        expected_root: normalizeBytes32(expectedRoot),
        commitments: [],
        merkle_index: merkleIndex,
        siblings: (storedPath as any).siblings.map(normalizeBytes32),
        directions: (storedPath as any).directions,
      }
    : {
        ...student,
        recipient,
        expected_root: normalizeBytes32(expectedRoot),
        commitments: commitments.map(normalizeBytes32),
        merkle_index: merkleIndex,
      };

  console.error('ROOT PASSED TO RUST:', expectedRoot);
  console.error('MERKLE INDEX PASSED TO RUST:', merkleIndex);
  console.error('COMMITMENT COUNT PASSED TO RUST:', hasStoredPath ? 0 : commitments.length);
  console.error('MERKLE PATH SOURCE:', hasStoredPath ? 'merkleNodes (stored)' : 'rebuilt from commitments');

  return runProver('prove', proverInput);
}

export { computeCommitment, computeNullifier, verifyProofOffChain, computeMerkleRoot, generateStudentFile };
