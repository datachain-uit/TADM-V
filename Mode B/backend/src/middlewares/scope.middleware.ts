import { HttpError } from './error.middleware';
import type { StaffSession } from './session.middleware';
import type { AppDependencies } from '../types/dependencies.types';

function createScopeGuards(scope: AppDependencies['scope']) {
  async function assertPoolOfSession(poolId: string, session: StaffSession) {
    if ((await scope.poolUniversityId(poolId)) !== session.universityId) {
      throw new HttpError(404, 'Pool not found');
    }
  }

  async function assertRequestOfSession(requestId: string, session: StaffSession) {
    if ((await scope.withdrawalRequestUniversityId(requestId)) !== session.universityId) {
      throw new HttpError(404, 'Withdrawal request not found');
    }
  }

  return { assertPoolOfSession, assertRequestOfSession };
}

export { createScopeGuards };
