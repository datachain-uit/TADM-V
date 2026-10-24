import type { NextFunction, Request, Response } from 'express';
import { readSession, readSessionToken, STAFF_SESSION_COOKIE, STUDENT_SESSION_COOKIE } from './session.middleware';
import type { StaffRole, StaffSession, StudentSession } from './session.middleware';

function requireStaff(role?: StaffRole) {
  return (request: Request, response: Response, next: NextFunction) => {
    const session = readSession(readSessionToken(request.headers.cookie, STAFF_SESSION_COOKIE));

    if (!session || session.kind !== 'staff') {
      response.status(401).json({ error: 'Login required' });
      return;
    }

    if (role && session.role !== role) {
      response.status(403).json({ error: `This action requires role ${role}` });
      return;
    }

    response.locals.session = session;
    next();
  };
}

function requireStudent(options: { allowTemporaryPassword?: boolean } = {}) {
  return (request: Request, response: Response, next: NextFunction) => {
    const session = readSession(readSessionToken(request.headers.cookie, STUDENT_SESSION_COOKIE));

    if (!session || session.kind !== 'student') {
      response.status(401).json({ error: 'Student login required' });
      return;
    }

    if (session.mustChangePassword && !options.allowTemporaryPassword) {
      response.status(403).json({ error: 'Change your temporary password first' });
      return;
    }

    response.locals.session = session;
    next();
  };
}

function staffSessionOf(response: Response): StaffSession {
  return response.locals.session as StaffSession;
}

function studentSessionOf(response: Response): StudentSession {
  return response.locals.session as StudentSession;
}

export { requireStaff, requireStudent, staffSessionOf, studentSessionOf };
