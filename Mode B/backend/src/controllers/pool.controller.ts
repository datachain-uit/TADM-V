import type { Request, Response } from 'express';
import { staffSessionOf } from '../middlewares/auth.middleware';
import { createScopeGuards } from '../middlewares/scope.middleware';
import { requireString, optionalString, routeParam } from '../validations/request.validation';
import type { AppDependencies } from '../types/dependencies.types';

function createPoolController(dependencies: AppDependencies) {
  const { services } = dependencies;
  const { assertPoolOfSession } = createScopeGuards(dependencies.scope);

  async function createPool(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.createPool(
        session.universityId,
        session.staffId,
        optionalString(request.body, 'programName'),
        optionalString(request.body, 'operatingWallet'),
        optionalString(request.body, 'denominationWei'),
      ),
    );
  }

  async function deployPool(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const poolId = routeParam(request, 'poolId');

    await assertPoolOfSession(poolId, session);
    response.json(await services.deployPool(poolId, session.staffId, requireString(request.body, 'initialFundingWei')));
  }

  async function fundPool(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const poolId = routeParam(request, 'poolId');

    await assertPoolOfSession(poolId, session);
    response.json(
      await services.fundPool(
        poolId,
        session.staffId,
        requireString(request.body, 'amountWei'),
        requireString(request.body, 'sponsorAddress'),
      ),
    );
  }

  async function recordSponsorFunding(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const poolId = routeParam(request, 'poolId');

    await assertPoolOfSession(poolId, session);
    response.json(
      await services.recordSponsorFunding(poolId, session.staffId, requireString(request.body, 'transactionHash')),
    );
  }

  async function readBalance(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const poolId = routeParam(request, 'poolId');

    await assertPoolOfSession(poolId, session);
    response.json(await services.readPoolBalance(poolId));
  }

  async function listPools(_request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(await services.listUniversityPools(session.universityId, session.staffId));
  }

  async function approveRoot(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const poolId = routeParam(request, 'poolId');

    await assertPoolOfSession(poolId, session);
    response.json(await services.approveRoot(poolId, session.staffId));
  }

  return {
    createPool,
    deployPool,
    fundPool,
    recordSponsorFunding,
    readBalance,
    listPools,
    approveRoot,
  };
}

export { createPoolController };
