import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import * as withdrawalRequestRepo from '../repositories/withdrawalRequest.repo';
import * as scholarshipPoolRepo from '../repositories/scholarshipPool.repo';
import '../repositories/universityStudent.repo';
import { authorizeAnyStaff } from './staffAuthorization.service';
import {
  assertPoolUniversity,
  getShieldedPoolContract,
  schoolAddressOf,
} from '../clients/blockchain/shieldedPoolClient';
import { computeNullifier, generateStudentFile, verifyProofOffChain } from './zkProof.service';
import { getMerklePath } from '../repositories/merkleNode.repo';
import { normalizeBytes32, decimalToBytes32 } from '../utils/bytes32';

const ZERO_ROOT = '0x' + '00'.repeat(32);

const APPROVED_TREE_STATUSES = ['ROOT_APPROVED', 'WITHDRAWAL_REQUESTED', 'WITHDRAWN'];

type DecryptedNote = {
  student_id: number;
  amount: string;
  rho: string;
};

type WithdrawalSubmission = {
  cid: string;
  note: DecryptedNote;
};

function withHexPrefix(value: string): string {
  return value.startsWith('0x') ? value : '0x' + value;
}

function validateSubmission(value: any): WithdrawalSubmission {
  if (typeof value?.cid !== 'string' || value.cid.length === 0 || !value?.note) {
    throw new Error('Input must contain cid and note');
  }

  const note = value.note;

  if (note.student_id === undefined || note.amount === undefined || note.rho === undefined) {
    throw new Error('Decrypted note has invalid fields');
  }

  return { cid: value.cid, note: { student_id: note.student_id, amount: note.amount, rho: note.rho } };
}

async function loadWithdrawalContext(cid: string) {
  const scholarship: any = await studentScholarshipRepo
    .findOne({ encryptedNoteCid: cid })
    .populate('universityStudent')
    .populate('pool');

  if (!scholarship) {
    throw new Error('Scholarship record not found');
  }

  const student = scholarship.universityStudent as any;
  const pool = scholarship.pool as any;

  if (!student) {
    throw new Error('University student profile not found');
  }

  if (!pool || pool.status !== 'DEPLOYED' || !pool.contractAddress) {
    throw new Error('Scholarship is not assigned to a deployed pool');
  }

  await assertPoolUniversity(pool.contractAddress, schoolAddressOf(pool), pool.chainId);

  if (scholarship.status !== 'ROOT_APPROVED') {
    throw new Error('Scholarship status must be ROOT_APPROVED. ' + `Current status: ${scholarship.status}`);
  }

  const activeRequest = await withdrawalRequestRepo.findOne({
    scholarship: scholarship._id,
    status: { $in: ['PENDING_APPROVAL', 'EXECUTION_FAILED'] },
  });

  if (activeRequest) {
    throw new Error('An active withdrawal request already exists');
  }

  return { scholarship, student, pool };
}

async function loadApprovedCommitments(pool: any, scholarship: any) {
  const approvedScholarships = await studentScholarshipRepo
    .find({
      pool: pool._id,
      status: { $in: APPROVED_TREE_STATUSES },
      commitment: { $exists: true, $ne: null },
      merkleIndex: { $exists: true, $ne: null },
    })
    .sort({ merkleIndex: 1 })
    .lean();

  if (approvedScholarships.length === 0) {
    throw new Error('No approved commitments found');
  }

  approvedScholarships.forEach((item: any, expectedIndex: number) => {
    if (Number(item.merkleIndex) !== expectedIndex) {
      throw new Error(
        'Approved Merkle indexes are not continuous. ' +
          `Expected ${expectedIndex}, ` +
          `received ${Number(item.merkleIndex)}`,
      );
    }
  });

  const merkleIndex = Number(scholarship.merkleIndex);
  const itemAtIndex = approvedScholarships[merkleIndex];

  if (!itemAtIndex || String(itemAtIndex._id) !== String(scholarship._id)) {
    throw new Error('Scholarship does not match its stored Merkle index');
  }

  return {
    commitments: approvedScholarships.map((item: any) => normalizeBytes32(String(item.commitment))),
    merkleIndex,
  };
}

function explainRejectedProof(
  proofData: any,
  currentRoot: string,
  backendNullifier: string,
  financeAmount: string,
  walletAddress: string,
) {
  if (normalizeBytes32(String(proofData.root)) !== currentRoot) {
    throw new Error('Proof rejected by the Halo2 verifier: root does not match currentRoot on-chain');
  }

  if (normalizeBytes32(String(proofData.nullifier)) !== backendNullifier) {
    throw new Error('Proof rejected by the Halo2 verifier: nullifier does not match the value computed by backend');
  }

  if (BigInt(proofData.amount).toString() !== financeAmount) {
    throw new Error('Proof rejected by the Halo2 verifier: amount does not match the Finance-approved amount');
  }

  if (BigInt(proofData.recipient) !== BigInt(walletAddress)) {
    throw new Error('Proof rejected by the Halo2 verifier: recipient does not match the registered student wallet');
  }
}

async function createWithdrawalRequest(submission: unknown) {
  if (!submission || typeof submission !== 'object') {
    throw new Error('Withdrawal submission is required');
  }

  const { cid, note } = validateSubmission(submission);
  const { scholarship, student, pool } = await loadWithdrawalContext(cid);
  const contract = getShieldedPoolContract(pool.contractAddress);
  const currentRoot = normalizeBytes32(String(await contract.methods.currentRoot().call()));

  if (currentRoot === ZERO_ROOT) {
    throw new Error('currentRoot is empty');
  }

  if (!(await contract.methods.validRoot(currentRoot).call())) {
    throw new Error('currentRoot is not approved');
  }

  const { commitments, merkleIndex } = await loadApprovedCommitments(pool, scholarship);
  const backendNullifier = computeNullifier(note);
  const financeAmount = BigInt(student.amountWei).toString();

  const storedPath = await getMerklePath(
    pool._id,
    merkleIndex,
    Number(pool.merkleDepth) || 0,
    (pool.merkleZeros as string[]) || [],
  );

  console.error(
    storedPath
      ? `MERKLE PATH: read ${storedPath.siblings.length} stored nodes`
      : `MERKLE PATH: not stored - rebuilding from ${commitments.length} commitments`,
  );

  const proofData = generateStudentFile(
    note,
    commitments,
    merkleIndex,
    currentRoot,
    scholarship.walletAddress,
    storedPath,
  );

  if (!proofData || !proofData.proof || !proofData.root || !proofData.nullifier || proofData.amount === undefined) {
    throw new Error('Rust prover returned incomplete proof data');
  }

  const proof = withHexPrefix(String(proofData.proof));

  let verification;

  try {
    verification = verifyProofOffChain(
      proof,
      currentRoot,
      backendNullifier,
      decimalToBytes32(financeAmount),
      scholarship.walletAddress,
    );
  } catch (verifyError) {
    explainRejectedProof(proofData, currentRoot, backendNullifier, financeAmount, scholarship.walletAddress);
    throw verifyError;
  }

  const expectedRoot = normalizeBytes32(String(proofData.root));
  const expectedNullifier = normalizeBytes32(String(proofData.nullifier));
  const amountWei = BigInt(proofData.amount).toString();

  if (expectedNullifier !== backendNullifier) {
    throw new Error('Proof nullifier does not match the nullifier computed by backend');
  }

  if (expectedRoot !== currentRoot) {
    throw new Error('Proof root does not match currentRoot');
  }

  if (BigInt(amountWei) <= 0n) {
    throw new Error('Proof amount must be greater than zero');
  }

  if (amountWei !== financeAmount) {
    throw new Error('Proof amount does not match Finance-approved amount');
  }

  if (await contract.methods.usedNullifier(expectedNullifier).call()) {
    throw new Error('This scholarship note has already been withdrawn');
  }

  const request = await withdrawalRequestRepo.create({
    pool: pool._id,
    poolContractAddress: pool.contractAddress,
    poolChainId: pool.chainId,
    scholarship: scholarship._id,
    expectedRoot,
    expectedNullifier,
    amountWei,
    recipient: scholarship.walletAddress,
    status: 'PENDING_APPROVAL',
    proofPreparedAt: new Date(),
    proof,
    localVerificationPassed: verification.verified,
    verificationMs: verification.verifyMs,
    verificationSetupMs: verification.setupMs,
  });

  scholarship.status = 'WITHDRAWAL_REQUESTED';
  await scholarship.save();

  return {
    id: String(request._id),
    scholarshipId: String(scholarship._id),
    poolId: String(pool._id),
    recipient: request.recipient,
    amountWei: request.amountWei,
    root: request.expectedRoot,
    nullifier: request.expectedNullifier,
    status: request.status,
    localVerificationPassed: request.localVerificationPassed,
    verificationMs: request.verificationMs,
    createdAt: request.createdAt,
  };
}

async function listUniversityWithdrawalRequests(universityId: string, staffId: string, status?: string) {
  await authorizeAnyStaff(universityId, staffId);

  const poolIds = (await scholarshipPoolRepo.find({ university: universityId }).select('_id')).map(
    (item: any) => item._id,
  );

  const requests = await withdrawalRequestRepo
    .find({ pool: { $in: poolIds }, ...(status ? { status } : {}) })
    .sort({ createdAt: 1 });

  return requests.map((item: any) => ({
    requestId: String(item._id),
    poolId: String(item.pool),
    status: item.status,
    amountWei: item.amountWei,
    recipient: item.recipient,
    transactionHash: item.transactionHash ?? null,
    createdAt: item.createdAt,
  }));
}

export { createWithdrawalRequest, validateSubmission, listUniversityWithdrawalRequests };
