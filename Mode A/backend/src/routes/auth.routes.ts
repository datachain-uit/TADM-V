import express from 'express';
import { requireStaff, requireStudent } from '../middlewares/auth.middleware';
import { createAuthController } from '../controllers/auth.controller';
import type { AppDependencies } from '../types/dependencies.types';

function createAuthRouter(dependencies: AppDependencies) {
  const controller = createAuthController(dependencies);
  const router = express.Router();

  router.post('/staff/login', controller.staffLogin);
  router.post('/staff/logout', controller.staffLogout);
  router.get('/staff/me', requireStaff(), controller.staffMe);
  router.post('/staff/password', requireStaff(), controller.changeStaffPassword);

  router.post('/student/login', controller.studentLogin);
  router.post('/student/logout', controller.studentLogout);
  router.get('/student/me', requireStudent({ allowTemporaryPassword: true }), controller.studentMe);
  router.post('/student/password', requireStudent({ allowTemporaryPassword: true }), controller.changeStudentPassword);

  return router;
}

export { createAuthRouter };
