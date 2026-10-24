import crypto from 'crypto';
import * as withdrawalRequestRepo from '../repositories/withdrawalRequest.repo';
import '../repositories/scholarshipPool.repo';
import {
  assertPoolUniversity,
  getPoolBalance,
  getShieldedPoolContract,
  resolveSender,
  schoolAddressOf,
} from '../clients/blockchain/shieldedPoolClient';
import { authorizeStaff, ROLE_LABEL } from './staffAuthorization.service';
import { normalizeBytes32 } from '../utils/bytes32';
import { universityIdOf } from '../utils/universityRef';
import { retryChainRead } from '../utils/chainRead';

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
    if (request.status !== 'PENDING_APPROVAL') {
      throw new Error('Only a pending request can be rejected');
    }

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

  if (requestedAmount !== financeAmount || requestedAmount !== BigInt(scholarship.amountWei).toString()) {
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

  if (String(await contract.methods.verifier().call()).toLowerCase() !== String(pool.verifierAddress).toLowerCase()) {
    throw new Error('Unexpected verifier contract');
  }

  const claim: any = await contract.methods.claims(expectedNullifier).call();

  if (claim.verified !== true) {
    throw new Error('No verified on-chain claim for this nullifier');
  }

  if (String(claim.recipient).toLowerCase() !== String(scholarship.walletAddress).toLowerCase()) {
    throw new Error('On-chain claim recipient differs from the registered student wallet');
  }

  if (BigInt(claim.amount) !== BigInt(requestedAmount)) {
    throw new Error('On-chain claim amount differs from the Finance-approved amount');
  }

  const poolBalanceBefore = await getPoolBalance(pool.contractAddress);

  if (!isReplayAttempt && BigInt(poolBalanceBefore) < BigInt(requestedAmount)) {
    throw new Error('Insufficient pool balance');
  }

  let tx: any;

  try {
    const method = contract.methods.settle(expectedNullifier);
    const gas = isReplayAttempt
      ? Number(request.gasLimit || 5_000_000)
      : Math.ceil(Number(await method.estimateGas({ from: school })) * 1.2);

    request.gasLimit = gas;
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
  request.settleGas = Number(tx.gasUsed);
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
    settleGas: request.settleGas,
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
