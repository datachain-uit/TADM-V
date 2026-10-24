import { authorizeStaff } from './staffAuthorization.service';
import * as universityStudentRepo from '../repositories/universityStudent.repo';
import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import { resolveDeployedPool } from '../repositories/scholarshipPool.repo';
import { normalizeAddress } from '../utils/address';
import { universityIdOf } from '../utils/universityRef';

async function registerStudentWallet(
  universityId: string,
  staffId: string,
  poolId: string,
  email: string,
  walletAddress: string,
  publicKey: string,
) {
  if (!universityId || !staffId || !poolId || !email || !walletAddress || !publicKey) {
    throw new Error('universityId, staffId, poolId, email, wallet and publicKey are required');
  }

  if (!/^0x04[0-9a-fA-F]{128}$/.test(publicKey)) {
    throw new Error('Public key must be an uncompressed secp256k1 key (0x04 + 128 hex characters)');
  }

  const wallet = normalizeAddress(walletAddress);

  await authorizeStaff(universityId, staffId, 'STUDENT_AFFAIRS');

  const universityStudent = await universityStudentRepo.findOne({
    university: universityId,
    email: email.trim().toLowerCase(),
  });

  if (!universityStudent) {
    throw new Error('University student profile not found');
  }

  if (
    universityStudent.eligibilityStatus !== 'ELIGIBLE' ||
    universityStudent.financeStatus !== 'APPROVED' ||
    !universityStudent.amountWei
  ) {
    throw new Error('Student must pass eligibility and finance approval first');
  }

  const pool = await resolveDeployedPool(poolId, universityId);

  if (universityIdOf(pool.university) !== String(universityId)) {
    throw new Error('The deployed pool does not belong to this university');
  }

  let scholarship = await studentScholarshipRepo.findOne({
    pool: pool._id,
    universityStudent: universityStudent._id,
  });

  if (scholarship?.commitment) {
    throw new Error('Cannot change wallet after note has been issued');
  }

  const walletInUse = await studentScholarshipRepo.findOne({
    walletAddress: wallet,
    ...(scholarship ? { _id: { $ne: scholarship._id } } : {}),
  });

  if (walletInUse) {
    throw new Error(
      'Wallet address is already used by another scholarship (pool ' +
        String(walletInUse.pool) +
        '). Each scholarship program needs its OWN address: reusing one lets an observer link the two payouts' +
        ' and shrinks the anonymity set. Register a NEW address.',
    );
  }

  const fields = {
    walletAddress: wallet,
    publicKey,
    amountWei: universityStudent.amountWei,
    status: 'WALLET_REGISTERED',
  };

  if (!scholarship) {
    scholarship = studentScholarshipRepo.build({ pool: pool._id, universityStudent: universityStudent._id, ...fields });
  } else {
    Object.assign(scholarship, fields);
  }

  await scholarship.save();

  return {
    scholarshipId: String(scholarship._id),
    poolId: String(scholarship.pool),
    walletAddress: scholarship.walletAddress,
    status: scholarship.status,
  };
}

export { registerStudentWallet };
