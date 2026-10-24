import crypto from 'crypto';

type StaffRole = 'STUDENT_AFFAIRS' | 'FINANCE';

type StaffSession = {
  kind: 'staff';
  universityId: string;
  staffId: string;
  role: StaffRole;
  expiresAt: number;
};

type StudentSession = {
  kind: 'student';
  universityId: string;
  studentId: number;
  mustChangePassword: boolean;
  walletChallenge?: {
    nonce: string;
    expiresAt: number;
  };
  expiresAt: number;
};

type Session = StaffSession | StudentSession;

const STAFF_SESSION_COOKIE = 'staff_session';
const STUDENT_SESSION_COOKIE = 'student_session';

type SessionCookieName = typeof STAFF_SESSION_COOKIE | typeof STUDENT_SESSION_COOKIE;

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sessions = new Map<string, Session>();

function createStaffSession(universityId: string, staffId: string, role: StaffRole): string {
  const token = crypto.randomBytes(32).toString('hex');

  sessions.set(token, {
    kind: 'staff',
    universityId,
    staffId,
    role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return token;
}

function createStudentSession(universityId: string, studentId: number, mustChangePassword: boolean): string {
  const token = crypto.randomBytes(32).toString('hex');

  sessions.set(token, {
    kind: 'student',
    universityId,
    studentId,
    mustChangePassword,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return token;
}

function readSession(token: string | undefined): Session | null {
  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function destroySession(token: string | undefined): void {
  if (token) {
    sessions.delete(token);
  }
}

function readSessionToken(cookieHeader: string | undefined, cookieName: SessionCookieName): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');

    if (name === cookieName) {
      return value.join('=');
    }
  }

  return undefined;
}

function sessionCookie(cookieName: SessionCookieName, token: string): string {
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/;` + ` Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearedSessionCookie(cookieName: SessionCookieName): string {
  return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export {
  STAFF_SESSION_COOKIE,
  STUDENT_SESSION_COOKIE,
  createStaffSession,
  createStudentSession,
  readSession,
  destroySession,
  readSessionToken,
  sessionCookie,
  clearedSessionCookie,
};

export type { StaffRole, StaffSession, StudentSession };
