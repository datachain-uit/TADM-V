import crypto from 'crypto';
import * as withdrawalRequestRepo from '../repositories/withdrawalRequest.repo';
import '../repositories/scholarshipPool.repo';
import {
  assertPoolUniversity,
  getPoolBalance,
  getShieldedPoolContract,
  resolveSender,
  schoolAddressOf,
  withGasBuffer,
} from '../clients/blockchain/shieldedPoolClient';
import { authorizeStaff, ROLE_LABEL } from './staffAuthorization.service';
import { normalizeBytes32, decimalToBytes32 } from '../utils/bytes32';
import { universityIdOf } from '../utils/universityRef';
import { retryChainRead } from '../utils/chainRead';
import { verifyProofOffChain } from './zkProof.service';

async function reviewWithdrawalRequest(requestId: string, staffId: string, decision: 'approve' | 'reject') {
  if (!requestId || !staffId || !['approve', 'reject'].includes(decision)) {
    throw new Error('A requestId, staffId and approve|reject decision are required');
  }

  const request: any = await withdrawalRequestRepo
    .findById(requestId)
    .populate({ path: 'scholarship', populate: { path: 'universityStudent' } })
    .populate('pool');

  if (!request) {
    throw new Error('Withdrawal request not found');
  }

  if (!['PENDING_APPROVAL', 'EXECUTION_FAILED', 'EXECUTED'].includes(request.status)) {
    throw new Error(`Request cannot be reviewed. Current status: ${request.status}`);
  }

  const isReplayAttempt = request.status === 'EXECUTED';

  if (isReplayAttempt && decision === 'reject') {
    throw new Error('An executed request cannot be rejected');
  }

  const scholarship = request.scholarship;
  const pool = request.pool;

  if (!pool || pool.status !== 'DEPLOYED') {
    throw new Error('Withdrawal request is not assigned to a deployed pool');
  }

  const staff = await authorizeStaff(universityIdOf(pool.university), staffId, 'FINANCE');

  console.error('reviewed by:', staff.staffId, '-', ROLE_LABEL[staff.role]);

  if (String(scholarship.pool) !== String(pool._id)) {
    throw new Error('Withdrawal request pool does not match scholarship pool');
  }

  if (
    String(request.poolContractAddress).toLowerCase() !== String(pool.contractAddress).toLowerCase() ||
    String(request.poolChainId) !== String(pool.chainId)
  ) {
    throw new Error('Withdrawal request blockchain domain does not match its pool');
  }

  if (decision === 'reject') {
    request.status = 'REJECTED';
    request.reviewedAt = new Date();
    request.failureReason = undefined;
    scholarship.status = 'ROOT_APPROVED';
    await request.save();
    await scholarship.save();

    return { id: String(request._id), status: request.status, reviewedAt: request.reviewedAt };
  }

  if (!request.localVerificationPassed) {
    throw new Error('Proof was not verified before University review');
  }

  const universityStudent = scholarship.universityStudent;
  const financeAmount = BigInt(universityStudent.amountWei).toString();
  const requestedAmount = BigInt(request.amountWei).toString();

  if (requestedAmount !== financeAmount) {
    throw new Error('Requested amount does not match Finance-approved amount');
  }

  if (String(request.recipient).toLowerCase() !== String(scholarship.walletAddress).toLowerCase()) {
    throw new Error('Recipient does not match the registered student wallet');
  }

  const expectedRoot = normalizeBytes32(String(request.expectedRoot));
  const expectedNullifier = normalizeBytes32(String(request.expectedNullifier));

  await assertPoolUniversity(pool.contractAddress, schoolAddressOf(pool), pool.chainId);

  const school = await resolveSender(schoolAddressOf(pool), process.env.UNIVERSITY_PRIVATE_KEY);
  const contract = getShieldedPoolContract(pool.contractAddress);

  if (!(await contract.methods.validRoot(expectedRoot).call())) {
    throw new Error('The proof root is not in validRoot history');
  }

  if (!request.proof) {
    throw new Error('Stored proof is missing');
  }

  verifyProofOffChain(
    request.proof,
    expectedRoot,
    expectedNullifier,
    decimalToBytes32(requestedAmount),
    request.recipient,
  );

  const poolBalanceBefore = await getPoolBalance(pool.contractAddress);

  if (!isReplayAttempt && BigInt(poolBalanceBefore) < BigInt(requestedAmount)) {
    throw new Error('Insufficient pool balance');
  }

  let tx: any;

  try {
    const withdrawalGasLimit = process.env.WITHDRAW_GAS_LIMIT || '300000';

    if (!/^[1-9][0-9]*$/.test(withdrawalGasLimit)) {
      throw new Error('WITHDRAW_GAS_LIMIT must be a positive integer');
    }

    const method = contract.methods.withdrawOffChain(
      expectedRoot,
      expectedNullifier,
      request.recipient,
      requestedAmount,
    );
    const gas = isReplayAttempt
      ? BigInt(withdrawalGasLimit).toString()
      : withGasBuffer(BigInt(await method.estimateGas({ from: school })));
    tx = await method.send({ from: school, gas });
  } catch (error: any) {
    const failureReason = error?.reason || error?.cause?.message || error?.message || 'Unknown blockchain error';

    if (!isReplayAttempt) {
      request.status = 'EXECUTION_FAILED';
      request.failureReason = failureReason;
      request.reviewedAt = new Date();
      await request.save();
    }

    console.error('Withdrawal execution failed:', failureReason);
    throw error;
  }

  request.status = 'EXECUTED';
  request.transactionHash = String(tx.transactionHash).toLowerCase();
  request.withdrawGasUsed = BigInt(tx.gasUsed).toString();
  request.reviewedAt = new Date();
  request.failureReason = undefined;
  scholarship.status = 'WITHDRAWN';
  scholarship.withdrawTxHash = request.transactionHash;
  await request.save();
  await scholarship.save();

  const payoutBlock = BigInt(tx.blockNumber);
  const usedNullifier = Boolean(
    await retryChainRead(() => contract.methods.usedNullifier(expectedNullifier).call({}, payoutBlock)),
  );

  if (!usedNullifier) {
    throw new Error('Unexpected nullifier state after withdrawal: the payout transaction did not mark it used');
  }

  return {
    id: String(request._id),
    status: request.status,
    recipient: request.recipient,
    amountWei: request.amountWei,
    nullifier: expectedNullifier,
    transactionHash: request.transactionHash,
    withdrawGasUsed: request.withdrawGasUsed,
    usedNullifier,
    poolBalanceBeforeWei: poolBalanceBefore,
    poolBalanceAfterWei: await getPoolBalance(pool.contractAddress, payoutBlock),
  };
}

function shuffleOrder<T>(list: T[]): T[] {
  const result = list.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }

  return result;
}

async function reviewWithdrawalBatch(requestIds: string[], staffId: string, decision: 'approve' | 'reject') {
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new Error('requestIds must be a non-empty array');
  }

  if (!staffId || !decision) {
    throw new Error('staffId and decision are required');
  }

  if (new Set(requestIds).size !== requestIds.length) {
    throw new Error('requestIds contains duplicates');
  }

  const payoutOrder = shuffleOrder(requestIds);

  console.error('batch review:', requestIds.length, 'requests | payout order shuffled (crypto.randomInt)');

  const result: any[] = [];
  const failed: any[] = [];

  for (const requestId of payoutOrder) {
    try {
      result.push(await reviewWithdrawalRequest(requestId, staffId, decision));
    } catch (error) {
      failed.push({ id: requestId, error: (error as Error).message });
    }
  }

  return {
    total: requestIds.length,
    succeeded: result.length,
    failed: failed.length,
    results: requestIds.map((id) => result.find((r) => String(r.id) === String(id))).filter(Boolean),
    failures: failed,
    shuffled: true,
  };
}

export { reviewWithdrawalRequest, reviewWithdrawalBatch };
