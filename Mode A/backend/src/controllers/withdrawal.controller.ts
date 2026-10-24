import type { Request, Response } from 'express';
import { staffSessionOf, studentSessionOf } from '../middlewares/auth.middleware';
import { HttpError } from '../middlewares/error.middleware';
import { createScopeGuards } from '../middlewares/scope.middleware';
import { requireDecision, routeParam } from '../validations/request.validation';
import type { AppDependencies } from '../types/dependencies.types';

function createWithdrawalController(dependencies: AppDependencies) {
  const { services } = dependencies;
  const { assertRequestOfSession } = createScopeGuards(dependencies.scope);

  async function listWithdrawals(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;

    response.json(await services.listUniversityWithdrawalRequests(session.universityId, session.staffId, status));
  }

  async function reviewBatch(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const requestIds = request.body?.requestIds;

    if (
      !Array.isArray(requestIds) ||
      requestIds.length === 0 ||
      !requestIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
    ) {
      throw new HttpError(400, 'requestIds must be a non-empty array of strings');
    }

    for (const requestId of requestIds) {
      await assertRequestOfSession(requestId, session);
    }

    response.json(await services.reviewWithdrawalBatch(requestIds, session.staffId, requireDecision(request.body)));
  }

  async function reviewOne(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const requestId = routeParam(request, 'requestId');

    await assertRequestOfSession(requestId, session);
    response.json(await services.reviewWithdrawalRequest(requestId, session.staffId, requireDecision(request.body)));
  }

  async function readOwnNote(request: Request, response: Response) {
    const session = studentSessionOf(response);
    const poolId = typeof request.query.poolId === 'string' ? request.query.poolId : '';

    if (!poolId) {
      throw new HttpError(400, 'poolId is required');
    }

    response.json(await services.readOwnEncryptedNote(session.universityId, session.studentId, poolId));
  }

  async function submitOwnWithdrawal(request: Request, response: Response) {
    const session = studentSessionOf(response);

    response.json(await services.submitOwnWithdrawal(session.universityId, session.studentId, request.body));
  }

  return {
    listWithdrawals,
    reviewBatch,
    reviewOne,
    readOwnNote,
    submitOwnWithdrawal,
  };
}

export { createWithdrawalController };
