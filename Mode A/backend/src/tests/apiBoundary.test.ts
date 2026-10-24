import type { AddressInfo } from 'net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app';

const UNIVERSITY_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const UNIVERSITY_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const STAFF = {
  'CTSV-01': { role: 'STUDENT_AFFAIRS', roleLabel: 'Student Affairs Office' },
  'KHTC-01': { role: 'FINANCE', roleLabel: 'Finance Office' },
} as Record<string, { role: string; roleLabel: string }>;

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
        if (!staff) {
          throw new Error('Invalid staff credentials');
        }
        if (password === 'no-password-yet') {
          throw new Error('Staff has no password set: ' + staffId);
        }
        if (password !== 'correct') {
          throw new Error('Invalid staff credentials');
        }
        return { universityId, staffId, role: staff.role, roleLabel: staff.roleLabel };
      },
      setStaffPassword: record('setStaffPassword'),
      createStudentProfile: record('createStudentProfile'),
      approveEligibility: record('approveEligibility'),
      approveFinance: record('approveFinance'),
      createPool: record('createPool'),
      deployPool: record('deployPool'),
      fundPool: record('fundPool'),
      recordSponsorFunding: record('recordSponsorFunding'),
      readPoolBalance: record('readPoolBalance'),
      issueScholarship: record('issueScholarship'),
      approveRoot: record('approveRoot'),
      reviewWithdrawalRequest: record('reviewWithdrawalRequest'),
      reviewWithdrawalBatch: record('reviewWithdrawalBatch'),
    },
    scope: {
      poolUniversityId: async (poolId: string) => (poolId === 'pool-of-b' ? UNIVERSITY_B : UNIVERSITY_A),
      withdrawalRequestUniversityId: async () => UNIVERSITY_A,
    },
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

async function login(base: string, staffId: string): Promise<string> {
  const response = await fetch(`${base}/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ universityId: UNIVERSITY_A, staffId, password: 'correct' }),
  });
  assert.equal(response.status, 200, `login of ${staffId} failed`);
  const cookie = String(response.headers.get('set-cookie'));
  return cookie.split(';')[0] as string;
}

function post(base: string, path: string, cookie: string | null, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('DX7: login sets an HttpOnly session cookie and /me reads the identity from it', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ universityId: UNIVERSITY_A, staffId: 'CTSV-01', password: 'correct' }),
    });
    const setCookie = String(response.headers.get('set-cookie'));

    assert.equal(response.status, 200);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const me = await fetch(`${base}/staff/me`, { headers: { Cookie: setCookie.split(';')[0] as string } });
    assert.deepEqual(await me.json(), {
      universityId: UNIVERSITY_A,
      staffId: 'CTSV-01',
      role: 'STUDENT_AFFAIRS',
    });
  });
});

test('DX7: staffId and universityId sent in the body are ignored — the session decides', async () => {
  await withServer(async (base, calls) => {
    const cookie = await login(base, 'CTSV-01');

    const response = await post(base, '/students/1001/eligibility', cookie, {
      decision: 'approve',
      staffId: 'KHTC-01',
      universityId: UNIVERSITY_B,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls.approveEligibility, [[UNIVERSITY_A, 'CTSV-01', 1001, 'approve']]);
  });
});

test('DX7: a wrong role or a missing session is stopped before the controller runs', async () => {
  await withServer(async (base, calls) => {
    const cookie = await login(base, 'CTSV-01');

    const wrongRole = await post(base, '/students/1001/finance', cookie, { amountWei: '1' });
    const noSession = await post(base, '/students/1001/eligibility', null, { decision: 'approve' });

    assert.equal(wrongRole.status, 403);
    assert.equal(noSession.status, 401);
    assert.equal(calls.approveFinance, undefined);
    assert.equal(calls.approveEligibility, undefined);
  });
});

test('DX7: a staff member can only change their own password', async () => {
  await withServer(async (base, calls) => {
    const cookie = await login(base, 'CTSV-01');

    const response = await post(base, '/staff/password', cookie, {
      password: 'new-secret',
      staffId: 'KHTC-01',
      actingStaffId: 'KHTC-01',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls.setStaffPassword, [[UNIVERSITY_A, 'CTSV-01', 'CTSV-01', 'new-secret']]);
  });
});

test('DX7: a pool of another university is not found, and its controller never runs', async () => {
  await withServer(async (base, calls) => {
    const cookie = await login(base, 'KHTC-01');

    const response = await post(base, '/pools/pool-of-b/fund', cookie, {
      amountWei: '1',
      sponsorAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });

    assert.equal(response.status, 404);
    assert.equal(calls.fundPool, undefined);
  });
});

test('DX7: deploy ignores a private key from the body, and issuing ignores rho from the body', async () => {
  await withServer(async (base, calls) => {
    const finance = await login(base, 'KHTC-01');
    const affairs = await login(base, 'CTSV-01');

    await post(base, '/pools/pool-of-a/deploy', finance, {
      initialFundingWei: '0',
      privateKey: '0x' + 'ee'.repeat(32),
    });
    await post(base, '/scholarships', affairs, {
      studentId: 1001,
      rho: '7',
    });

    assert.deepEqual(calls.deployPool, [['pool-of-a', 'KHTC-01', '0']]);
    assert.deepEqual(calls.issueScholarship, [[UNIVERSITY_A, 'CTSV-01', 1001]]);
  });
});

test('DX7: every failed login looks the same to the client', async () => {
  await withServer(async (base) => {
    const attempts = [
      { staffId: 'CTSV-01', password: 'wrong' },
      { staffId: 'CTSV-01', password: 'no-password-yet' },
      { staffId: 'NOBODY-99', password: 'correct' },
    ];
    const answers = [];

    for (const attempt of attempts) {
      const response = await fetch(`${base}/staff/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universityId: UNIVERSITY_A, ...attempt }),
      });
      answers.push([response.status, await response.json(), response.headers.get('set-cookie')]);
    }

    for (const answer of answers) {
      assert.deepEqual(answer, [401, { error: 'Invalid staff credentials' }, null]);
    }
  });
});

test('DX7: recording a sponsor funding passes only the transaction hash — amount and sender come from the chain', async () => {
  await withServer(async (base, calls) => {
    const finance = await login(base, 'KHTC-01');
    const affairs = await login(base, 'CTSV-01');
    const hash = '0x' + 'ab'.repeat(32);

    const ok = await post(base, '/pools/pool-of-a/fundings', finance, {
      transactionHash: hash,
      amountWei: '999',
      sponsorAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      staffId: 'CTSV-01',
    });
    const wrongRole = await post(base, '/pools/pool-of-a/fundings', affairs, { transactionHash: hash });
    const otherUniversity = await post(base, '/pools/pool-of-b/fundings', finance, { transactionHash: hash });
    const missingHash = await post(base, '/pools/pool-of-a/fundings', finance, {});

    assert.equal(ok.status, 200);
    assert.equal(wrongRole.status, 403);
    assert.equal(otherUniversity.status, 404);
    assert.equal(missingHash.status, 400);
    assert.deepEqual(calls.recordSponsorFunding, [['pool-of-a', 'KHTC-01', hash]]);
  });
});
