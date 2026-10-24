import express from 'express';
import { requireStaff } from '../middlewares/auth.middleware';
import { createPoolController } from '../controllers/pool.controller';
import type { AppDependencies } from '../types/dependencies.types';

function createPoolRouter(dependencies: AppDependencies) {
  const controller = createPoolController(dependencies);
  const router = express.Router();

  router.post('/pools', requireStaff('FINANCE'), controller.createPool);
  router.post('/pools/:poolId/deploy', requireStaff('FINANCE'), controller.deployPool);
  router.post('/pools/:poolId/fund', requireStaff('FINANCE'), controller.fundPool);
  router.post('/pools/:poolId/fundings', requireStaff('FINANCE'), controller.recordSponsorFunding);
  router.get('/pools/:poolId/balance', requireStaff(), controller.readBalance);
  router.get('/pools', requireStaff(), controller.listPools);
  router.post('/pools/:poolId/root/approve', requireStaff('STUDENT_AFFAIRS'), controller.approveRoot);

  return router;
}

export { createPoolRouter };
