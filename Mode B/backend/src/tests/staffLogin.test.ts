import test from 'node:test';
import assert from 'node:assert/strict';
import { UniversityStaff } from '../models/universityStaff.model';
import { hashStaffPassword, verifyStaffPassword, staffLogin } from '../services/staff.service';

const UNI = '507f1f77bcf86cd799439011';

function stubStaff(doc: any) {
  UniversityStaff.findOne = (async () => doc) as any;
}

test('hashStaffPassword produces scrypt$<salt>$<hash>', () => {
  const stored = hashStaffPassword('long-enough-password');
  const parts = stored.split('$');

  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'scrypt');
  assert.ok(parts[1]!.length > 0);
  assert.ok(parts[2]!.length > 0);
});

test('hashStaffPassword REJECTS a password shorter than 8 characters', () => {
  assert.throws(() => hashStaffPassword('short'), /at least 8 characters/);
});

test('hashing the same password twice gives DIFFERENT results (random salt)', () => {
  const a = hashStaffPassword('long-enough-password');
  const b = hashStaffPassword('long-enough-password');

  assert.notEqual(a, b);
});

test('verifyStaffPassword: right password -> true, wrong -> false', () => {
  const stored = hashStaffPassword('long-enough-password');

  assert.equal(verifyStaffPassword('long-enough-password', stored), true);
  assert.equal(verifyStaffPassword('wrong-password', stored), false);
});

test('verifyStaffPassword returns false for a corrupt stored string, without throwing', () => {
  assert.equal(verifyStaffPassword('long-enough-password', ''), false);
  assert.equal(verifyStaffPassword('long-enough-password', 'not-scrypt'), false);
  assert.equal(verifyStaffPassword('long-enough-password', 'bcrypt$abc$def'), false);
});

test('staffLogin returns identity + role, NOT passwordHash', async () => {
  stubStaff({
    university: UNI,
    staffId: 'KHTC-01',
    role: 'FINANCE',
    status: 'ACTIVE',
    passwordHash: hashStaffPassword('long-enough-password'),
  });

  const session = await staffLogin(UNI, 'KHTC-01', 'long-enough-password');

  assert.equal(session.staffId, 'KHTC-01');
  assert.equal(session.role, 'FINANCE');
  assert.equal(session.roleLabel, 'Finance Office');
  assert.equal(Object.prototype.hasOwnProperty.call(session, 'passwordHash'), false);
});

test('staffLogin REJECTS a wrong password', async () => {
  stubStaff({
    university: UNI,
    staffId: 'CTSV-01',
    role: 'STUDENT_AFFAIRS',
    status: 'ACTIVE',
    passwordHash: hashStaffPassword('long-enough-password'),
  });

  await assert.rejects(() => staffLogin(UNI, 'CTSV-01', 'wrong-password'), /Invalid staff credentials/);
});

test('staffLogin does not reveal which staffId exists', async () => {
  stubStaff(null);

  await assert.rejects(() => staffLogin(UNI, 'NO-SUCH-STAFF', 'long-enough-password'), /Invalid staff credentials/);
});

test('staffLogin REJECTS a locked account', async () => {
  stubStaff({
    university: UNI,
    staffId: 'KHTC-01',
    role: 'FINANCE',
    status: 'INACTIVE',
    passwordHash: hashStaffPassword('long-enough-password'),
  });

  await assert.rejects(() => staffLogin(UNI, 'KHTC-01', 'long-enough-password'), /not ACTIVE/);
});

test('staffLogin REJECTS an account with no password set', async () => {
  stubStaff({
    university: UNI,
    staffId: 'CTSV-01',
    role: 'STUDENT_AFFAIRS',
    status: 'ACTIVE',
  });

  await assert.rejects(() => staffLogin(UNI, 'CTSV-01', 'long-enough-password'), /no password set/);
});
