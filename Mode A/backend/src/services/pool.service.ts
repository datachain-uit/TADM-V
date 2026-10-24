import mongoose from 'mongoose';
import { authorizeStaff, authorizeAnyStaff } from './staffAuthorization.service';
import * as universityRepo from '../repositories/university.repo';
import * as scholarshipPoolRepo from '../repositories/scholarshipPool.repo';
import { resolveDeployedPool } from '../repositories/scholarshipPool.repo';
import {
  assertUnsignedWei,
  schoolAddressOf,
  deployShieldedPool,
  assertPoolUniversity,
  fundScholarshipPool,
  readSponsorFunding,
  getPoolBalance,
} from '../clients/blockchain/shieldedPoolClient';
import { universityIdOf } from '../utils/universityRef';

const DEFAULT_PROGRAM_NAME = 'Academic Encouragement Scholarship';

function presentPool(pool: any) {
  return {
    poolId: String(pool._id),
    universityId: universityIdOf(pool.university),
    programName: pool.programName,
    universityAddress: pool.universityAddress,
    contractAddress: pool.contractAddress ?? null,
    ...(pool.verifierAddress ? { verifierAddress: pool.verifierAddress } : {}),
    chainId: pool.chainId ?? null,
    status: pool.status,
  };
}

async function createScholarshipPool(
  universityId: string,
  staffId: string,
  programName: string = DEFAULT_PROGRAM_NAME,
  operatingWallet?: string,
  denominationWei: string = '0',
) {
  if (!universityId || !staffId) {
    throw new Error('universityId and staffId are required');
  }

  if (!mongoose.Types.ObjectId.isValid(universityId)) {
    throw new Error('Invalid university id');
  }

  await authorizeStaff(universityId, staffId, 'FINANCE');

  const university = await universityRepo.findOne({ _id: universityId, status: 'ACTIVE' });

  if (!university) {
    throw new Error('Active university not found');
  }

  const trimmedProgramName = String(programName || '').trim();

  if (!trimmedProgramName) {
    throw new Error('programName must not be empty');
  }

  const existingPool = await scholarshipPoolRepo.findOne({
    university: university._id,
    programName: trimmedProgramName,
    status: { $in: ['PENDING_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED'] },
  });

  if (existingPool) {
    throw new Error('University already has an active scholarship pool for program: ' + trimmedProgramName);
  }

  const pool = await scholarshipPoolRepo.create({
    university: university._id,
    universityAddress: operatingWallet || university.walletAddress,
    programName: trimmedProgramName,
    status: 'PENDING_DEPLOYMENT',
    initialFundingWei: '0',
    denominationWei: assertUnsignedWei(String(denominationWei || '0'), 'denominationWei'),
  });

  return presentPool(pool);
}

async function deployScholarshipPool(poolId: string, staffId: string, initialFundingWei: string = '0') {
  if (!poolId || !staffId) {
    throw new Error('poolId and staffId are required');
  }

  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error('Invalid scholarship pool id');
  }

  const fundingWei = assertUnsignedWei(initialFundingWei, 'initialFundingWei');
  const poolForAuth = await scholarshipPoolRepo.findById(poolId);

  if (!poolForAuth) {
    throw new Error('Scholarship pool not found');
  }

  await authorizeStaff(String(poolForAuth.university), staffId, 'FINANCE');

  const pool = await scholarshipPoolRepo.findOneAndUpdate(
    { _id: poolId, status: { $in: ['PENDING_DEPLOYMENT', 'DEPLOYMENT_FAILED'] } },
    { $set: { status: 'DEPLOYING', initialFundingWei: fundingWei, deploymentError: undefined } },
    { new: true },
  );

  if (!pool) {
    throw new Error('Pool is not awaiting deployment');
  }

  try {
    const result = await deployShieldedPool(
      schoolAddressOf(pool),
      fundingWei,
      process.env.UNIVERSITY_PRIVATE_KEY,
      String(pool.denominationWei ?? '0'),
    );

    pool.contractAddress = result.contractAddress;
    pool.chainId = result.chainId;
    pool.deploymentTransactionHash = result.transactionHash;
    pool.deploymentGasUsed = result.gasUsed;
    pool.status = 'DEPLOYED';
    pool.deployedAt = new Date();
    pool.deploymentError = undefined;
    await pool.save();
    console.error('deployment gasUsed:', result.gasUsed);

    return {
      ...presentPool(pool),
      deploymentTransactionHash: pool.deploymentTransactionHash,
      deploymentGasUsed: pool.deploymentGasUsed,
      balanceWei: result.balanceWei,
    };
  } catch (error: any) {
    pool.status = 'DEPLOYMENT_FAILED';
    pool.deploymentError = error?.message || String(error);
    await pool.save();
    throw error;
  }
}

async function fundPool(poolId: string, staffId: string, amountWei: string, sponsorAddress: string) {
  if (!poolId || !staffId || !amountWei || !sponsorAddress) {
    throw new Error('poolId, staffId, amountWei and sponsorAddress are required');
  }

  const pool = await resolveDeployedPool(poolId);

  await authorizeStaff(universityIdOf(pool.university), staffId, 'FINANCE');
  await assertPoolUniversity(pool.contractAddress, schoolAddressOf(pool), pool.chainId);

  const result = await fundScholarshipPool(pool.contractAddress, amountWei, sponsorAddress);

  return {
    poolId: String(pool._id),
    contractAddress: pool.contractAddress,
    sponsorAddress: result.sponsorAddress,
    amountWei: assertUnsignedWei(amountWei, 'amountWei'),
    transactionHash: result.transactionHash,
    gasUsed: result.gasUsed,
    balanceWei: result.balanceWei,
  };
}

async function recordSponsorFunding(poolId: string, staffId: string, transactionHash: string) {
  if (!poolId || !staffId || !transactionHash) {
    throw new Error('poolId, staffId and transactionHash are required');
  }

  const pool = await resolveDeployedPool(poolId);

  await authorizeStaff(universityIdOf(pool.university), staffId, 'FINANCE');
  await assertPoolUniversity(pool.contractAddress, schoolAddressOf(pool), pool.chainId);

  const result = await readSponsorFunding(pool.contractAddress, transactionHash);

  return {
    poolId: String(pool._id),
    contractAddress: pool.contractAddress,
    sponsorAddress: result.sponsorAddress,
    amountWei: result.amountWei,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    balanceWei: result.balanceWei,
  };
}

async function readPoolBalance(poolId: string) {
  if (!poolId) {
    throw new Error('poolId is required');
  }

  const pool = await resolveDeployedPool(poolId);
  const universityAddress = await assertPoolUniversity(pool.contractAddress, schoolAddressOf(pool), pool.chainId);

  return {
    poolId: String(pool._id),
    contractAddress: pool.contractAddress,
    universityAddress,
    chainId: pool.chainId,
    balanceWei: await getPoolBalance(pool.contractAddress),
  };
}

async function listUniversityPools(universityId: string, staffId: string) {
  await authorizeAnyStaff(universityId, staffId);

  const pools = await scholarshipPoolRepo.find({ university: universityId }).sort({ createdAt: 1 });

  return pools.map((item: any) => ({
    poolId: String(item._id),
    programName: item.programName,
    status: item.status,
    universityAddress: item.universityAddress,
    contractAddress: item.contractAddress ?? null,
    chainId: item.chainId ?? null,
    denominationWei: item.denominationWei ?? null,
    currentRoot: item.currentRoot ?? null,
  }));
}

export {
  createScholarshipPool,
  deployScholarshipPool,
  fundPool,
  recordSponsorFunding,
  readPoolBalance,
  listUniversityPools,
};
