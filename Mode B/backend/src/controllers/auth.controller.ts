import type { Request, Response } from 'express';
import {
  createStaffSession,
  createStudentSession,
  destroySession,
  readSessionToken,
  sessionCookie,
  clearedSessionCookie,
  STAFF_SESSION_COOKIE,
  STUDENT_SESSION_COOKIE,
} from '../middlewares/session.middleware';
import { staffSessionOf, studentSessionOf } from '../middlewares/auth.middleware';
import { HttpError } from '../middlewares/error.middleware';
import { requireString, requireStudentId } from '../validations/request.validation';
import type { AppDependencies } from '../types/dependencies.types';

const LOGIN_FAILED = 'Invalid staff credentials';

const STUDENT_LOGIN_FAILED = 'Invalid student credentials';

function createAuthController(dependencies: AppDependencies) {
  const { services } = dependencies;

  async function staffLogin(request: Request, response: Response) {
    const universityId = requireString(request.body, 'universityId');
    const staffId = requireString(request.body, 'staffId');
    const password = requireString(request.body, 'password');

    let identity;

    try {
      identity = await services.staffLogin(universityId, staffId, password);
    } catch (error: any) {
      console.error('Staff login failed:', error?.message);
      throw new HttpError(401, LOGIN_FAILED);
    }

    const token = createStaffSession(identity.universityId, identity.staffId, identity.role);

    response.setHeader('Set-Cookie', sessionCookie(STAFF_SESSION_COOKIE, token));
    response.json(identity);
  }

  function staffLogout(request: Request, response: Response) {
    destroySession(readSessionToken(request.headers.cookie, STAFF_SESSION_COOKIE));
    response.setHeader('Set-Cookie', clearedSessionCookie(STAFF_SESSION_COOKIE));
    response.json({ loggedOut: true });
  }

  function staffMe(_request: Request, response: Response) {
    const session = staffSessionOf(response);

    response.json({
      universityId: session.universityId,
      staffId: session.staffId,
      role: session.role,
    });
  }

  async function changeStaffPassword(request: Request, response: Response) {
    const session = staffSessionOf(response);
    const password = requireString(request.body, 'password');

    await services.setStaffPassword(session.universityId, session.staffId, session.staffId, password);

    response.json({ staffId: session.staffId, passwordChanged: true });
  }

  async function studentLogin(request: Request, response: Response) {
    const universityId = requireString(request.body, 'universityId');
    const studentId = requireStudentId(request.body?.studentId);
    const password = requireString(request.body, 'password');

    let identity;

    try {
      identity = await services.studentLogin(universityId, studentId, password);
    } catch (error: any) {
      console.error('Student login failed:', error?.message);
      throw new HttpError(401, STUDENT_LOGIN_FAILED);
    }

    const token = createStudentSession(identity.universityId, identity.studentId, identity.mustChangePassword === true);

    response.setHeader('Set-Cookie', sessionCookie(STUDENT_SESSION_COOKIE, token));
    response.json(identity);
  }

  function studentLogout(request: Request, response: Response) {
    destroySession(readSessionToken(request.headers.cookie, STUDENT_SESSION_COOKIE));
    response.setHeader('Set-Cookie', clearedSessionCookie(STUDENT_SESSION_COOKIE));
    response.json({ loggedOut: true });
  }

  async function studentMe(_request: Request, response: Response) {
    const session = studentSessionOf(response);
    const overview = await services.readStudentOverview(session.universityId, session.studentId);

    response.json({
      ...overview,
      mustChangePassword: session.mustChangePassword,
    });
  }

  async function changeStudentPassword(request: Request, response: Response) {
    const session = studentSessionOf(response);

    await services.changeStudentPassword(
      session.universityId,
      session.studentId,
      requireString(request.body, 'currentPassword'),
      requireString(request.body, 'newPassword'),
    );

    session.mustChangePassword = false;
    response.json({ studentId: session.studentId, passwordChanged: true });
  }

  return {
    staffLogin,
    staffLogout,
    staffMe,
    changeStaffPassword,
    studentLogin,
    studentLogout,
    studentMe,
    changeStudentPassword,
  };
}

export { createAuthController };
