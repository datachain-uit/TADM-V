import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import * as withdrawalRequestRepo from '../repositories/withdrawalRequest.repo';
import * as scholarshipPoolRepo from '../repositories/scholarshipPool.repo';
import '../repositories/universityStudent.repo';
import { authorizeAnyStaff } from './staffAuthorization.service';
import { getShieldedPoolContract, resolveSender } from '../clients/blockchain/shieldedPoolClient';
import { computeCommitment, computeNullifier, generateStudentFile } from './zkProof.service';
import { getMerklePath } from '../repositories/merkleNode.repo';
import { normalizeBytes32, decimalToBytes32 } from '../utils/bytes32';

const ZERO_ROOT = '0x' + '00'.repeat(32);

const VERIFIER_CALL_GAS = 3_000_000;

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

function validateSubmission(value: any): WithdrawalSubmission {
  if (typeof value?.cid !== 'string' || value.cid.length === 0) {
    throw new Error('Input must contain cid and note');
  }

  const note = value.note;

  if (!Number.isSafeInteger(note?.student_id) || note.student_id <= 0) {
    throw new Error('Invalid note student_id');
  }

  if (!/^\d+$/.test(note?.amount) || BigInt(note.amount) <= 0n) {
    throw new Error('Invalid note amount');
  }

  if (!/^\d+$/.test(note?.rho) || BigInt(note.rho) <= 0n) {
    throw new Error('Invalid note rho');
  }

  return { cid: value.cid, note: { student_id: note.student_id, amount: note.amount, rho: note.rho } };
}

function explainRejectedProof(
  generated: any,
  currentRoot: string,
  nullifier: string,
  financeAmount: string,
  walletAddress: string,
) {
  if (generated.root.toLowerCase() !== currentRoot.toLowerCase()) {
    throw new Error('Proof rejected by Halo2Verifier: root does not match currentRoot on-chain');
  }

  if (generated.nullifier.toLowerCase() !== nullifier.toLowerCase()) {
    throw new Error('Proof rejected by Halo2Verifier: nullifier does not match the value computed by backend');
  }

  if (BigInt(generated.amount) !== BigInt(financeAmount)) {
    throw new Error('Proof rejected by Halo2Verifier: amount does not match the Finance-approved amount');
  }

  if (BigInt(generated.recipient) !== BigInt(walletAddress)) {
    throw new Error('Proof rejected by Halo2Verifier: recipient does not match the registered student wallet');
  }
}

async function createWithdrawalRequest(submission: unknown) {
  if (!submission || typeof submission !== 'object') {
    throw new Error('Withdrawal submission is required');
  }

  const { cid, note } = validateSubmission(submission);

  const scholarship: any = await studentScholarshipRepo
    .findOne({ encryptedNoteCid: cid })
    .populate('universityStudent')
    .populate('pool');

  if (!scholarship) {
    throw new Error('Scholarship record not found for CID');
  }

  const student = scholarship.universityStudent as any;
  const pool = scholarship.pool as any;

  if (!student || !pool || pool.status !== 'DEPLOYED') {
    throw new Error('Scholarship pool/student data is incomplete');
  }

  if (scholarship.status !== 'ROOT_APPROVED') {
    throw new Error('Scholarship status must be ROOT_APPROVED');
  }

  if (student.studentId !== note.student_id || student.amountWei !== note.amount) {
    throw new Error('Decrypted note does not match the approved student/Finance amount');
  }

  if (!pool.contractAddress || !pool.verifierAddress || !pool.chainId) {
    throw new Error('Pool contract/verifier is not ready');
  }

  const activeRequest = await withdrawalRequestRepo.findOne({
    scholarship: scholarship._id,
    status: { $in: ['PENDING_APPROVAL', 'EXECUTION_FAILED'] },
  });

  if (activeRequest) {
    throw new Error('An active withdrawal request already exists');
  }

  if (computeCommitment(note).toLowerCase() !== String(scholarship.commitment).toLowerCase()) {
    throw new Error('Decrypted note does not match stored commitment');
  }

  const nullifier = computeNullifier(note);
  const contract = getShieldedPoolContract(pool.contractAddress);
  const currentRoot = normalizeBytes32(String(await contract.methods.currentRoot().call()));

  const [validRoot, usedNullifier, chainVerifier] = await Promise.all([
    contract.methods.validRoot(currentRoot).call(),
    contract.methods.usedNullifier(nullifier).call(),
    contract.methods.verifier().call(),
  ]);

  if (currentRoot === ZERO_ROOT || validRoot !== true) {
    throw new Error('Current root is empty or not valid on-chain');
  }

  if (usedNullifier === true) {
    throw new Error('Nullifier was already used');
  }

  if (String(chainVerifier).toLowerCase() !== String(pool.verifierAddress).toLowerCase()) {
    throw new Error('Unexpected verifier contract');
  }

  const approved = await studentScholarshipRepo
    .find({ pool: pool._id, commitment: { $exists: true }, status: { $in: APPROVED_TREE_STATUSES } })
    .sort({ merkleIndex: 1 });

  approved.forEach((item: any, index: number) => {
    if (item.merkleIndex !== index) {
      throw new Error('Approved Merkle indexes are not contiguous');
    }
  });

  const merkleIndex = Number(scholarship.merkleIndex);
  const itemAtIndex = approved[merkleIndex];

  if (!itemAtIndex || String(itemAtIndex._id) !== String(scholarship._id)) {
    throw new Error('Scholarship does not match its stored Merkle index');
  }

  const commitments = approved.map((item: any) => item.commitment);

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

  const generated = generateStudentFile(
    note,
    commitments,
    merkleIndex,
    currentRoot,
    scholarship.walletAddress,
    storedPath,
  );

  const financeAmount = String(student.amountWei);
  const recipientWord = scholarship.walletAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const trustedCalldata =
    '0x' +
    currentRoot.slice(2) +
    normalizeBytes32(nullifier).slice(2) +
    decimalToBytes32(financeAmount).slice(2) +
    recipientWord +
    generated.calldata.replace(/^0x/, '').slice(256);

  const sender = await resolveSender(
    String(await contract.methods.school().call()),
    process.env.UNIVERSITY_PRIVATE_KEY,
  );
  const signingContract = getShieldedPoolContract(pool.contractAddress);

  let verifyReceipt: any;

  try {
    verifyReceipt = await signingContract.methods
      .verifyAndRecord(
        trustedCalldata,
        currentRoot,
        normalizeBytes32(nullifier),
        scholarship.walletAddress,
        financeAmount,
      )
      .send({ from: sender, gas: VERIFIER_CALL_GAS });
  } catch (verifyError) {
    explainRejectedProof(generated, currentRoot, nullifier, financeAmount, scholarship.walletAddress);
    throw verifyError;
  }

  const request = await withdrawalRequestRepo.create({
    pool: pool._id,
    scholarship: scholarship._id,
    poolContractAddress: pool.contractAddress,
    poolChainId: pool.chainId,
    proof: generated.proof,
    calldata: generated.calldata,
    expectedRoot: generated.root,
    expectedNullifier: generated.nullifier,
    amountWei: note.amount,
    recipient: scholarship.walletAddress,
    localVerificationPassed: true,
    status: 'PENDING_APPROVAL',
    proofPreparedAt: new Date(),
    verifyRecordTxHash: String(verifyReceipt.transactionHash).toLowerCase(),
    verifyRecordGas: Number(verifyReceipt.gasUsed),
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
    verifierChecked: request.localVerificationPassed,
    verifyRecordTxHash: request.verifyRecordTxHash,
    verifyRecordGas: request.verifyRecordGas,
    calldataBytes: (request.calldata.length - 2) / 2,
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
