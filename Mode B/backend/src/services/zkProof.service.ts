import { runProver } from '../clients/prover/halo2ProverClient';
import { normalizeBytes32 } from '../utils/bytes32';

type StudentNote = {
  student_id: number;
  amount: string;
  rho: string;
};

type ProofPackage = {
  proof: string;
  calldata: string;
  root: string;
  nullifier: string;
  amount: string;
  recipient: string;
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

function generateStudentFile(
  note: StudentNote,
  commitments: string[],
  merkleIndex: number,
  expectedRoot: string,
  recipient: string,
  storedPath?: { siblings: string[]; directions: boolean[] } | null,
): ProofPackage {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(recipient))) {
    throw new Error('Invalid recipient wallet address');
  }
  const hasStoredPath =
    Boolean(storedPath) && Array.isArray(storedPath?.siblings) && (storedPath?.siblings.length || 0) > 0;
  const result = runProver('prove', {
    ...note,
    commitments: hasStoredPath ? [] : commitments.map(normalizeBytes32),
    merkle_index: merkleIndex,
    expected_root: normalizeBytes32(expectedRoot),
    recipient,
    ...(hasStoredPath
      ? {
          siblings: (storedPath as any).siblings.map(normalizeBytes32),
          directions: (storedPath as any).directions,
        }
      : {}),
  });
  const proofPackage: ProofPackage = {
    proof: String(result.proof),
    calldata: String(result.calldata),
    root: normalizeBytes32(result.root),
    nullifier: normalizeBytes32(result.nullifier),
    amount: normalizeBytes32(result.amount),
    recipient: normalizeBytes32(result.recipient),
  };
  if (!/^0x[0-9a-fA-F]+$/.test(proofPackage.calldata)) {
    throw new Error('Prover returned invalid calldata hex');
  }
  const publicInputs = [
    `0x${proofPackage.calldata.slice(2, 66)}`,
    `0x${proofPackage.calldata.slice(66, 130)}`,
    `0x${proofPackage.calldata.slice(130, 194)}`,
    `0x${proofPackage.calldata.slice(194, 258)}`,
  ];
  if (
    publicInputs[0]?.toLowerCase() !== proofPackage.root.toLowerCase() ||
    publicInputs[1]?.toLowerCase() !== proofPackage.nullifier.toLowerCase() ||
    publicInputs[2]?.toLowerCase() !== proofPackage.amount.toLowerCase() ||
    publicInputs[3]?.toLowerCase() !== proofPackage.recipient.toLowerCase() ||
    BigInt(proofPackage.recipient) !== BigInt(recipient)
  ) {
    throw new Error('Public inputs do not match root/nullifier/amount/recipient in calldata');
  }
  return proofPackage;
}

export { computeCommitment, computeMerkleRoot, computeNullifier, generateStudentFile };
