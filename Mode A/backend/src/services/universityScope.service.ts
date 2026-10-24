import mongoose from 'mongoose';
import * as scholarshipPoolRepo from '../repositories/scholarshipPool.repo';
import * as withdrawalRequestRepo from '../repositories/withdrawalRequest.repo';

async function poolUniversityId(poolId: string): Promise<string | null> {
  if (!mongoose.isValidObjectId(poolId)) {
    return null;
  }

  const pool = await scholarshipPoolRepo.findById(poolId).select('university');

  return pool ? String(pool.university) : null;
}

async function withdrawalRequestUniversityId(requestId: string): Promise<string | null> {
  if (!mongoose.isValidObjectId(requestId)) {
    return null;
  }

  const request = await withdrawalRequestRepo.findById(requestId).select('pool');

  return request ? poolUniversityId(String(request.pool)) : null;
}

export { poolUniversityId, withdrawalRequestUniversityId };
