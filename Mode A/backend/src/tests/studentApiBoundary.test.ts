import type { AddressInfo } from 'net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app';

const UNIVERSITY_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const POOL_A = 'cccccccccccccccccccccccc';

const STAFF = {
  'CTSV-01': { role: 'STUDENT_AFFAIRS', roleLabel: 'Student Affairs Office' },
  'KHTC-01': { role: 'FINANCE', roleLabel: 'Finance Office' },
} as Record<string, { role: string; roleLabel: string }>;

const NOTE_SUBMISSION = {
  cid: 'Qm1',
  note: { student_id: 1001, amount: '2', rho: '123' },
};

const WALLET = {
  poolId: POOL_A,
  email: 'student@uni.edu',
  walletAddress: '0x' + '66'.repeat(20),
  publicKey: '0x04' + '11'.repeat(64),
};

function fakeDependencies() {
  const calls: Record<string, unknown[][]> = {};

  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return { ok: name };
    };

  const dependencies = {
    services: {
      staffLogin: async (universityId: string, staffId: string, password: string) => {
        const staff = STAFF[staffId];
        if (!staff || password !== 'correct') {
          throw new Error('Invalid staff credentials');
        }
        return { universityId, staffId, role: staff.role, roleLabel: staff.roleLabel };
      },
      studentLogin: async (universityId: string, studentId: number, password: string) => {
        if (studentId === 404404) {
          throw new Error('no such student');
        }
        if (password === 'temporary') {
          return { universityId, studentId, mustChangePassword: true };
        }
        if (password !== 'correct') {
          throw new Error('Invalid student credentials');
        }
        return { universityId, studentId, mustChangePassword: false };
      },
      changeStudentPassword: record('changeStudentPassword'),
      readStudentOverview: record('readStudentOverview'),
      readOwnEncryptedNote: record('readOwnEncryptedNote'),
      submitOwnWithdrawal: record('submitOwnWithdrawal'),
      setStudentTemporaryPassword: record('setStudentTemporaryPassword'),
      registerStudentWallet: record('registerStudentWallet'),
      listUniversityStudents: record('listUniversityStudents'),
      listUniversityPools: record('listUniversityPools'),
      listUniversityWithdrawalRequests: record('listUniversityWithdrawalRequests'),
    },
    scope: {
      poolUniversityId: async () => UNIVERSITY_A,
      withdrawalRequestUniversityId: async () => UNIVERSITY_A,
    },
    universityPrivateKey: () => undefined,
  };

  return { dependencies, calls };
}

async function withServer(run: (base: string, calls: Record<string, unknown[][]>) => Promise<void>) {
  const { dependencies, calls } = fakeDependencies();
  const server = createApp(dependencies).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  try {
    await run(base, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function send(base: string, method: string, path: string, cookie: string | null, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function studentLogin(base: string, studentId: number, password = 'correct'): Promise<string> {
  const response = await send(base, 'POST', '/student/login', null, {
    universityId: UNIVERSITY_A,
    studentId,
    password,
  });
  assert.equal(response.status, 200, `student login of ${studentId} failed`);
  return String(response.headers.get('set-cookie')).split(';')[0] as string;
}

async function staffLogin(base: string, staffId: string): Promise<string> {
  const response = await send(base, 'POST', '/staff/login', null, {
    universityId: UNIVERSITY_A,
    staffId,
    password: 'correct',
  });
  assert.equal(response.status, 200, `staff login of ${staffId} failed`);
  return String(response.headers.get('set-cookie')).split(';')[0] as string;
}

test('studentId comes from the student session, never from the body or the query', async () => {
  await withServer(async (base, calls) => {
    const cookie = await studentLogin(base, 1001);

    await send(base, 'GET', '/student/me', cookie);
    await send(base, 'GET', `/student/note?poolId=${POOL_A}&studentId=2002`, cookie);
    await send(base, 'POST', '/student/withdrawal', cookie, {
      ...NOTE_SUBMISSION,
      studentId: 2002,
      universityId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    });

    assert.deepEqual(calls.readStudentOverview, [[UNIVERSITY_A, 1001]]);
    assert.deepEqual(calls.readOwnEncryptedNote, [[UNIVERSITY_A, 1001, POOL_A]]);
    assert.equal((calls.submitOwnWithdrawal?.[0] as unknown[])?.[0], UNIVERSITY_A);
    assert.equal((calls.submitOwnWithdrawal?.[0] as unknown[])?.[1], 1001);
  });
});

test('with a temporary password only me / password / logout are allowed', async () => {
  await withServer(async (base, calls) => {
    const cookie = await studentLogin(base, 1001, 'temporary');

    const blocked = await send(base, 'POST', '/student/withdrawal', cookie, NOTE_SUBMISSION);
    const me = await send(base, 'GET', '/student/me', cookie);
    const changed = await send(base, 'POST', '/student/password', cookie, {
      currentPassword: 'temporary',
      newPassword: 'new-secret-1',
    });
    const afterChange = await send(base, 'POST', '/student/withdrawal', cookie, NOTE_SUBMISSION);

    assert.equal(blocked.status, 403);
    assert.equal(me.status, 200);
    assert.equal((await me.json()).mustChangePassword, true);
    assert.equal(changed.status, 200);
    assert.equal(afterChange.status, 200);
    assert.deepEqual(calls.changeStudentPassword, [[UNIVERSITY_A, 1001, 'temporary', 'new-secret-1']]);
    assert.equal(calls.submitOwnWithdrawal?.length, 1);
  });
});

test('staff sessions cannot use student routes and student sessions cannot use staff routes', async () => {
  await withServer(async (base, calls) => {
    const staff = await staffLogin(base, 'CTSV-01');
    const student = await studentLogin(base, 1001);

    const staffAsStudent = await send(base, 'POST', '/student/withdrawal', staff, NOTE_SUBMISSION);
    const studentAsStaff = await send(base, 'POST', '/students/1001/eligibility', student, { decision: 'approve' });
    const studentRegistersWallet = await send(base, 'POST', '/students/wallet', student, WALLET);
    const studentReadsStaffList = await send(base, 'GET', '/students', student);

    assert.equal(staffAsStudent.status, 401);
    assert.equal(studentAsStaff.status, 401);
    assert.equal(studentRegistersWallet.status, 401);
    assert.equal(studentReadsStaffList.status, 401);
    assert.equal(calls.submitOwnWithdrawal, undefined);
    assert.equal(calls.registerStudentWallet, undefined);
  });
});

test('one browser can hold a staff session and a student session at the same time', async () => {
  await withServer(async (base) => {
    const staff = await staffLogin(base, 'CTSV-01');
    const student = await studentLogin(base, 1001);
    assert.match(staff, /^staff_session=/);
    assert.match(student, /^student_session=/);

    const jar = `${staff}; ${student}`;
    assert.equal((await send(base, 'GET', '/staff/me', jar)).status, 200);
    assert.equal((await send(base, 'GET', '/student/me', jar)).status, 200);

    await send(base, 'POST', '/student/logout', jar);
    assert.equal((await send(base, 'GET', '/staff/me', jar)).status, 200);
    assert.equal((await send(base, 'GET', '/student/me', jar)).status, 401);
  });
});

test('every failed student login looks the same to the client', async () => {
  await withServer(async (base) => {
    const attempts = [
      { studentId: 1001, password: 'wrong' },
      { studentId: 404404, password: 'correct' },
    ];
    const answers = [];

    for (const attempt of attempts) {
      const response = await send(base, 'POST', '/student/login', null, { universityId: UNIVERSITY_A, ...attempt });
      answers.push([response.status, await response.json(), response.headers.get('set-cookie')]);
    }

    for (const answer of answers) {
      assert.deepEqual(answer, [401, { error: 'Invalid student credentials' }, null]);
    }
  });
});

test('Student Affairs registers the wallet; the staff id comes from the session', async () => {
  await withServer(async (base, calls) => {
    const affairs = await staffLogin(base, 'CTSV-01');
    const finance = await staffLogin(base, 'KHTC-01');

    const registered = await send(base, 'POST', '/students/wallet', affairs, { ...WALLET, staffId: 'KHTC-01' });
    const wrongRole = await send(base, 'POST', '/students/wallet', finance, WALLET);
    const missingKey = await send(base, 'POST', '/students/wallet', affairs, { ...WALLET, publicKey: '' });

    assert.equal(registered.status, 200);
    assert.equal(wrongRole.status, 403);
    assert.equal(missingKey.status, 400);
    assert.deepEqual(calls.registerStudentWallet, [
      [UNIVERSITY_A, 'CTSV-01', POOL_A, WALLET.email, WALLET.walletAddress, WALLET.publicKey],
    ]);
  });
});

test('Student Affairs sets a temporary password; read routes take identity from the session', async () => {
  await withServer(async (base, calls) => {
    const affairs = await staffLogin(base, 'CTSV-01');
    const finance = await staffLogin(base, 'KHTC-01');

    const setPassword = await send(base, 'POST', '/students/1001/password', affairs, {
      temporaryPassword: 'temp-pass-1',
      staffId: 'KHTC-01',
    });
    const financeSetsPassword = await send(base, 'POST', '/students/1001/password', finance, {
      temporaryPassword: 'temp-pass-1',
    });
    const students = await send(base, 'GET', '/students', finance);

    assert.equal(setPassword.status, 200);
    assert.equal(financeSetsPassword.status, 403);
    assert.equal(students.status, 200);
    assert.deepEqual(calls.setStudentTemporaryPassword, [[UNIVERSITY_A, 'CTSV-01', 1001, 'temp-pass-1']]);
    assert.deepEqual(calls.listUniversityStudents, [[UNIVERSITY_A, 'KHTC-01']]);
  });
});
