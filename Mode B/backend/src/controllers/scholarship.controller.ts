import type { Request, Response } from 'express';
import { staffSessionOf } from '../middlewares/auth.middleware';
import { requireStudentId } from '../validations/request.validation';
import type { AppDependencies } from '../types/dependencies.types';

function createScholarshipController(dependencies: AppDependencies) {
  const { services } = dependencies;

  async function issueScholarship(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.issueScholarship(session.universityId, session.staffId, requireStudentId(request.body?.studentId)),
    );
  }

  return {
    issueScholarship,
  };
}

export { createScholarshipController };
