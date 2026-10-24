import * as universityRepo from '../repositories/university.repo';
import * as universityStaffRepo from '../repositories/universityStaff.repo';
import { authorizeAnyStaff, ROLE_LABEL } from './staffAuthorization.service';
import crypto from 'crypto';

async function createUniversityStaff(
  universityId: string,
  actingStaffId: string,
  staffId: string,
  role: 'STUDENT_AFFAIRS' | 'FINANCE',
) {
  if (!universityId || !actingStaffId || !staffId || !['STUDENT_AFFAIRS', 'FINANCE'].includes(role)) {
    throw new Error('A universityId, staffId and role (STUDENT_AFFAIRS|FINANCE) are required');
  }

  const actingStaff = await authorizeAnyStaff(universityId, actingStaffId);

  const university = await universityRepo.findById(universityId);
  if (!university) throw new Error('University not found');

  const existing = await universityStaffRepo.findOne({ university: universityId, staffId });
  if (existing) throw new Error('Staff already exists in this university: ' + staffId);

  const staff = await universityStaffRepo.create({ university: universityId, staffId, role });

  console.error('created by:', actingStaff.staffId, '-', ROLE_LABEL[actingStaff.role]);
  return { universityId: String(staff.university), staffId: staff.staffId, role: staff.role, status: staff.status };
}

async function seedDefaultStaff(universityId: string) {
  const wanted: Array<['STUDENT_AFFAIRS' | 'FINANCE', string]> = [
    ['STUDENT_AFFAIRS', 'CTSV-01'],
    ['FINANCE', 'KHTC-01'],
  ];

  const created = {} as Record<'STUDENT_AFFAIRS' | 'FINANCE', string>;
  for (const [role, staffId] of wanted) {
    const existing = await universityStaffRepo.findOne({ university: universityId, staffId });
    if (!existing) {
      await universityStaffRepo.create({ university: universityId, staffId, role });
    }
    created[role] = staffId;
  }
  return created;
}

const SCRYPT_KEYLEN = 64;

const SALT_BYTES = 16;

function hashStaffPassword(password: string): string {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return 'scrypt$' + salt + '$' + derived;
}

function verifyStaffPassword(password: string, stored: string): boolean {
  if (!stored || typeof stored !== 'string' || typeof password !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const hex = parts[2];
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  if (expected.length === 0) return false;
  const derived = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(derived, expected);
}

async function setStaffPassword(universityId: string, actingStaffId: string, staffId: string, password: string) {
  if (!universityId || !actingStaffId || !staffId) {
    throw new Error('A universityId, actingStaffId and staffId are required');
  }

  const actingStaff = await authorizeAnyStaff(universityId, actingStaffId);

  const staff = await universityStaffRepo.findOne({ university: universityId, staffId });
  if (!staff) throw new Error('Staff not found in this university: ' + staffId);

  staff.passwordHash = hashStaffPassword(password);
  await staff.save();

  console.error('set by:', actingStaff.staffId, '-', ROLE_LABEL[actingStaff.role]);

  return { staffId: staff.staffId, role: staff.role };
}

async function staffLogin(universityId: string, staffId: string, password: string) {
  if (!universityId || !staffId || !password) {
    throw new Error('A universityId, staffId and password are required');
  }

  const staff = await universityStaffRepo.findOne({ university: universityId, staffId });

  const FAILED = 'Invalid staff credentials';

  if (!staff) throw new Error(FAILED);
  if (staff.status !== 'ACTIVE') throw new Error('Staff account is not ACTIVE: ' + staffId);
  if (!staff.passwordHash) {
    throw new Error('Staff has no password set: ' + staffId + ' (set one with npm run staff:password first)');
  }
  if (!verifyStaffPassword(password, staff.passwordHash)) throw new Error(FAILED);

  return {
    universityId: String(staff.university),
    staffId: staff.staffId,
    role: staff.role,
    roleLabel: ROLE_LABEL[staff.role],
  };
}

export {
  createUniversityStaff,
  seedDefaultStaff,
  hashStaffPassword,
  verifyStaffPassword,
  setStaffPassword,
  staffLogin,
};
