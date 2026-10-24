import mongoose from 'mongoose';
import { ScholarshipPool } from '../models/scholarshipPool.model';
import '../models/university.model';

async function resolveDeployedPool(
  poolId?: string,

  universityId?: string,
) {
  if (poolId) {
    if (!mongoose.Types.ObjectId.isValid(poolId)) {
      throw new Error('Invalid scholarship pool id');
    }

    const pool = await ScholarshipPool.findOne({
      _id: poolId,
      status: 'DEPLOYED',
    }).populate('university');

    if (!pool) {
      throw new Error('Deployed scholarship pool not found');
    }

    return pool;
  }

  const pools = await ScholarshipPool.find({
    status: 'DEPLOYED',

    ...(universityId
      ? {
          university: universityId,
        }
      : {}),
  })
    .limit(2)
    .populate('university');

  if (pools.length === 0) {
    throw new Error(
      universityId ? 'University does not have a deployed scholarship pool' : 'No deployed scholarship pool exists',
    );
  }

  if (pools.length > 1) {
    throw new Error('More than one deployed pool exists. Supply poolId explicitly.');
  }

  return pools[0];
}

export { resolveDeployedPool };

export const create = (data: any) => ScholarshipPool.create(data);

export const find = (filter: any) => ScholarshipPool.find(filter);

export const findById = (id: unknown) => ScholarshipPool.findById(id);

export const findOne = (filter: any) => ScholarshipPool.findOne(filter);

export const findOneAndUpdate = (filter: any, update: any, options: mongoose.QueryOptions) =>
  ScholarshipPool.findOneAndUpdate(filter, update, options);
