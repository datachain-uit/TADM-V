import express from 'express';
import { requireStaff } from '../middlewares/auth.middleware';
import { createStudentController } from '../controllers/student.controller';
import type { AppDependencies } from '../types/dependencies.types';

function createStudentRouter(dependencies: AppDependencies) {
  const controller = createStudentController(dependencies);
  const router = express.Router();

  router.post('/students', requireStaff('STUDENT_AFFAIRS'), controller.createStudent);
  router.post('/students/:studentId/eligibility', requireStaff('STUDENT_AFFAIRS'), controller.reviewEligibility);
  router.post('/students/:studentId/password', requireStaff('STUDENT_AFFAIRS'), controller.setTemporaryPassword);
  router.post('/students/:studentId/finance', requireStaff('FINANCE'), controller.approveFinance);
  router.post('/students/wallet', requireStaff('STUDENT_AFFAIRS'), controller.registerWallet);
  router.get('/students', requireStaff(), controller.listStudents);

  return router;
}

export { createStudentRouter };
