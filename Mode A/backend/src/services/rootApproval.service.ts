import { authorizeStaff } from './staffAuthorization.service';
import { computeMerkleRoot } from './zkProof.service';
import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import { resolveDeployedPool } from '../repositories/scholarshipPool.repo';
import { saveMerkleTree } from '../repositories/merkleNode.repo';
import {
  assertPoolUniversity,
  getShieldedPoolContract,
  resolveSender,
  schoolAddressOf,
  withGasBuffer,
} from '../clients/blockchain/shieldedPoolClient';
import { normalizeBytes32 } from '../utils/bytes32';
import { retryChainRead } from '../utils/chainRead';
import { universityIdOf } from '../utils/universityRef';

const TREE_STATUSES = ['NOTE_CREATED', 'ROOT_APPROVED', 'WITHDRAWAL_REQUESTED', 'WITHDRAWN'];

async function approveRoot(poolId: string, staffId: string) {
  if (!poolId || !staffId) {
    throw new Error('poolId and staffId are required');
  }

  const pool = await resolveDeployedPool(poolId);

  await authorizeStaff(universityIdOf(pool.university), staffId, 'STUDENT_AFFAIRS');
  await assertPoolUniversity(pool.contractAddress, schoolAddressOf(pool), pool.chainId);

  const school = await resolveSender(schoolAddressOf(pool), process.env.UNIVERSITY_PRIVATE_KEY);
  const contract = getShieldedPoolContract(pool.contractAddress);
  const scholarships = await studentScholarshipRepo
    .find({
      pool: pool._id,
      status: { $in: TREE_STATUSES },
      commitment: { $exists: true, $ne: null },
      merkleIndex: { $exists: true, $ne: null },
    })
    .sort({ merkleIndex: 1 })
    .lean();

  if (scholarships.length === 0) {
    throw new Error('No commitments found in MongoDB. Issue at least one scholarship note first.');
  }

  scholarships.forEach((scholarship: any, expectedIndex: number) => {
    const actualIndex = Number(scholarship.merkleIndex);

    if (actualIndex !== expectedIndex) {
      throw new Error(
        `Merkle indexes are not continuous. Expected index ${expectedIndex}, but received ${actualIndex}.`,
      );
    }
  });

  const commitments = scholarships.map((scholarship: any) => normalizeBytes32(String(scholarship.commitment)));
  const rootData = computeMerkleRoot(commitments);
  const candidateRoot = normalizeBytes32(String(rootData.root));
  const rootBefore = normalizeBytes32(String(await contract.methods.currentRoot().call()));

  let transactionHash: string | undefined;
  let rootUpdateGasUsed: string | undefined;
  let readBlock: bigint | 'latest' = 'latest';

  if (rootBefore !== candidateRoot) {
    const method = contract.methods.updateRoot(candidateRoot, commitments);
    const estimatedGas = BigInt(await method.estimateGas({ from: school }));
    const tx = await method.send({ from: school, gas: withGasBuffer(estimatedGas) });

    transactionHash = String(tx.transactionHash).toLowerCase();
    readBlock = BigInt(tx.blockNumber);
    rootUpdateGasUsed = BigInt(tx.gasUsed).toString();
    pool.lastRootUpdateGasUsed = rootUpdateGasUsed;
    pool.currentRoot = candidateRoot;
    pool.rootHistory.push({ root: candidateRoot, transactionHash, approvedAt: new Date() });

    if (Array.isArray(rootData.nodes) && Array.isArray(rootData.zeros)) {
      const nodeCount = await saveMerkleTree(pool._id, rootData.nodes);

      pool.merkleZeros = rootData.zeros.map((value: string) => normalizeBytes32(String(value)));
      pool.merkleDepth = rootData.nodes.length - 1;
      console.error(`Merkle nodes saved: ${nodeCount} | depth: ${pool.merkleDepth}`);
    } else {
      console.error('Prover did not return tree nodes - withdrawal will rebuild the tree');
    }

    await pool.save();
  }

  const rootAfter = normalizeBytes32(
    String(await retryChainRead(() => contract.methods.currentRoot().call({}, readBlock))),
  );

  const isValid = Boolean(await retryChainRead(() => contract.methods.validRoot(candidateRoot).call({}, readBlock)));

  if (rootAfter !== candidateRoot) {
    throw new Error('Root stored on smart contract does not match the root computed from MongoDB commitments');
  }

  if (!isValid) {
    throw new Error('Candidate root was not added to validRoot history');
  }

  await studentScholarshipRepo.updateMany(
    {
      pool: pool._id,
      _id: {
        $in: scholarships
          .filter((scholarship: any) => scholarship.status === 'NOTE_CREATED')
          .map((scholarship: any) => scholarship._id),
      },
      status: 'NOTE_CREATED',
    },
    {
      $set: {
        status: 'ROOT_APPROVED',
        approvedRoot: candidateRoot,
        ...(transactionHash ? { rootTransactionHash: transactionHash } : {}),
      },
    },
  );

  return {
    poolId: String(pool._id),
    root: candidateRoot,
    transactionHash: transactionHash ?? null,
    rootUpdateGasUsed: rootUpdateGasUsed ?? null,
    currentRoot: rootAfter,
    validRoot: isValid,
  };
}

export { approveRoot };
