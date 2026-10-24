import express from 'express';
import { requireStaff } from '../middlewares/auth.middleware';
import { createScholarshipController } from '../controllers/scholarship.controller';
import type { AppDependencies } from '../types/dependencies.types';

function createScholarshipRouter(dependencies: AppDependencies) {
  const controller = createScholarshipController(dependencies);
  const router = express.Router();

  router.post('/scholarships', requireStaff('STUDENT_AFFAIRS'), controller.issueScholarship);

  return router;
}

export { createScholarshipRouter };
