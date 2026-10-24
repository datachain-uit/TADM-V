import type { Request } from 'express';
import { HttpError } from '../middlewares/error.middleware';

function requireString(body: any, field: string): string {
  const value = body?.[field];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required`);
  }

  return value.trim();
}

function optionalString(body: any, field: string): string | undefined {
  const value = body?.[field];

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }

  return value.trim();
}

function requireStudentId(value: unknown): number {
  const studentId = Number(value);

  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    throw new HttpError(400, 'studentId must be a positive integer');
  }

  return studentId;
}

function requireDecision(body: any): 'approve' | 'reject' {
  const decision = body?.decision;

  if (decision !== 'approve' && decision !== 'reject') {
    throw new HttpError(400, 'decision must be "approve" or "reject"');
  }

  return decision;
}

function routeParam(request: Request, name: string): string {
  const value = request.params[name];

  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `${name} is required`);
  }

  return value;
}

export { requireString, optionalString, requireStudentId, requireDecision, routeParam };
