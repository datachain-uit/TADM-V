import type { Request, Response } from 'express';
import { staffSessionOf } from '../middlewares/auth.middleware';
import { requireString, requireStudentId, requireDecision, routeParam } from '../validations/request.validation';
import type { AppDependencies } from '../types/dependencies.types';

function createStudentController(dependencies: AppDependencies) {
  const { services } = dependencies;

  async function createStudent(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.createStudentProfile(
        session.universityId,
        session.staffId,
        requireStudentId(request.body?.studentId),
        requireString(request.body, 'email'),
      ),
    );
  }

  async function reviewEligibility(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.approveEligibility(
        session.universityId,
        session.staffId,
        requireStudentId(routeParam(request, 'studentId')),
        requireDecision(request.body),
      ),
    );
  }

  async function setTemporaryPassword(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.setStudentTemporaryPassword(
        session.universityId,
        session.staffId,
        requireStudentId(routeParam(request, 'studentId')),
        requireString(request.body, 'temporaryPassword'),
      ),
    );
  }

  async function approveFinance(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.approveFinance(
        session.universityId,
        session.staffId,
        requireStudentId(routeParam(request, 'studentId')),
        requireString(request.body, 'amountWei'),
      ),
    );
  }

  async function registerWallet(request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(
      await services.registerStudentWallet(
        session.universityId,
        session.staffId,
        requireString(request.body, 'poolId'),
        requireString(request.body, 'email'),
        requireString(request.body, 'walletAddress'),
        requireString(request.body, 'publicKey'),
      ),
    );
  }

  async function listStudents(_request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json(await services.listUniversityStudents(session.universityId, session.staffId));
  }

  return {
    createStudent,
    reviewEligibility,
    setTemporaryPassword,
    approveFinance,
    registerWallet,
    listStudents,
  };
}

export { createStudentController };
