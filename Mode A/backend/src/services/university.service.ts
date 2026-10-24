import * as universityRepo from '../repositories/university.repo';
import { normalizeAddress } from '../utils/address';
import { seedDefaultStaff } from './staff.service';

async function createUniversity(name: string, walletAddress: string) {
  if (!name || !walletAddress) {
    throw new Error('University name and walletAddress are required');
  }

  const normalizedName = String(name).trim();

  if (!normalizedName) {
    throw new Error('University name is required');
  }

  const normalizedWallet = normalizeAddress(walletAddress);
  const existing = await universityRepo.findOne({
    $or: [{ name: normalizedName }, { walletAddress: normalizedWallet }],
  });

  if (existing) {
    throw new Error('University name or wallet address already exists');
  }

  const university = await universityRepo.create({
    name: normalizedName,
    walletAddress: normalizedWallet,
    status: 'ACTIVE',
  });

  await seedDefaultStaff(String(university._id));

  return {
    universityId: String(university._id),
    name: university.name,
    walletAddress: university.walletAddress,
    status: university.status,
  };
}

export { createUniversity };
