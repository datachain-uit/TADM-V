import test from 'node:test';
import assert from 'node:assert/strict';
import { UniversityStaff } from '../models/universityStaff.model';
import { authorizeStaff, authorizeAnyStaff } from '../services/staffAuthorization.service';

const UNI = '507f1f77bcf86cd799439011';

function stubStaff(doc: any) {
  UniversityStaff.findOne = (async () => doc) as any;
}

test('authorizeStaff returns the staff member when the role matches', async () => {
  stubStaff({
    staffId: 'CTSV-01',
    role: 'STUDENT_AFFAIRS',
    status: 'ACTIVE',
  });

  const staff = await authorizeStaff(UNI, 'CTSV-01', 'STUDENT_AFFAIRS');

  assert.equal(staff.staffId, 'CTSV-01');
});

test('authorizeStaff REJECTS a wrong role', async () => {
  stubStaff({
    staffId: 'CTSV-01',
    role: 'STUDENT_AFFAIRS',
    status: 'ACTIVE',
  });

  await assert.rejects(() => authorizeStaff(UNI, 'CTSV-01', 'FINANCE'), /Role mismatch/);
});

test('authorizeStaff REJECTS a staff member that does not exist', async () => {
  stubStaff(null);

  await assert.rejects(() => authorizeStaff(UNI, 'NO-SUCH-STAFF', 'FINANCE'), /Staff not found/);
});

test('authorizeStaff REJECTS a locked account', async () => {
  stubStaff({
    staffId: 'KHTC-01',
    role: 'FINANCE',
    status: 'INACTIVE',
  });

  await assert.rejects(() => authorizeStaff(UNI, 'KHTC-01', 'FINANCE'), /not ACTIVE/);
});

test('authorizeStaff REJECTS a missing staffId', async () => {
  stubStaff({
    staffId: 'KHTC-01',
    role: 'FINANCE',
    status: 'ACTIVE',
  });

  await assert.rejects(() => authorizeStaff(UNI, '', 'FINANCE'), /universityId and staffId are required/);
});

test('authorizeAnyStaff accepts EVERY valid role', async () => {
  for (const role of ['STUDENT_AFFAIRS', 'FINANCE']) {
    stubStaff({
      staffId: 'X-01',
      role,
      status: 'ACTIVE',
    });

    const staff = await authorizeAnyStaff(UNI, 'X-01');
    assert.equal(staff.role, role);
  }
});

test('authorizeAnyStaff STILL blocks a locked account', async () => {
  stubStaff({
    staffId: 'X-01',
    role: 'FINANCE',
    status: 'INACTIVE',
  });

  await assert.rejects(() => authorizeAnyStaff(UNI, 'X-01'), /not ACTIVE/);
});
