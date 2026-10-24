import express from 'express';
import { requireStaff, requireStudent } from '../middlewares/auth.middleware';
import { createWithdrawalController } from '../controllers/withdrawal.controller';
import type { AppDependencies } from '../types/dependencies.types';

function createWithdrawalRouter(dependencies: AppDependencies) {
  const controller = createWithdrawalController(dependencies);
  const router = express.Router();

  router.get('/withdrawals', requireStaff(), controller.listWithdrawals);
  router.post('/withdrawals/review-batch', requireStaff('FINANCE'), controller.reviewBatch);
  router.post('/withdrawals/:requestId/review', requireStaff('FINANCE'), controller.reviewOne);

  router.get('/student/note', requireStudent(), controller.readOwnNote);
  router.post('/student/withdrawal', requireStudent(), controller.submitOwnWithdrawal);

  return router;
}

export { createWithdrawalRouter };
