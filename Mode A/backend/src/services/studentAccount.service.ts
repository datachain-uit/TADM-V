import * as universityStudentRepo from '../repositories/universityStudent.repo';
import * as scholarshipPoolRepo from '../repositories/scholarshipPool.repo';
import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import { authorizeStaff } from './staffAuthorization.service';
import { hashStaffPassword, verifyStaffPassword } from './staff.service';

const STUDENT_LOGIN_FAILED = 'Invalid student credentials';

function requireStudentNumber(studentId: number) {
  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    throw new Error('studentId must be a positive integer');
  }
}

async function findStudent(universityId: string, studentId: number) {
  requireStudentNumber(studentId);

  return universityStudentRepo.findOne({
    university: universityId,
    studentId,
  });
}

async function setStudentTemporaryPassword(
  universityId: string,
  staffId: string,
  studentId: number,
  temporaryPassword: string,
) {
  await authorizeStaff(universityId, staffId, 'STUDENT_AFFAIRS');

  const student = await findStudent(universityId, studentId);

  if (!student) {
    throw new Error('University student profile not found');
  }

  student.passwordHash = hashStaffPassword(temporaryPassword);
  student.mustChangePassword = true;
  await student.save();

  return {
    studentId: student.studentId,
    mustChangePassword: true,
  };
}

async function studentLogin(universityId: string, studentId: number, password: string) {
  if (!universityId || !password) {
    throw new Error(STUDENT_LOGIN_FAILED);
  }

  const student = await findStudent(universityId, studentId);

  if (!student || !student.passwordHash || !verifyStaffPassword(password, student.passwordHash)) {
    throw new Error(STUDENT_LOGIN_FAILED);
  }

  return {
    universityId: String(student.university),
    studentId: student.studentId,
    mustChangePassword: student.mustChangePassword === true,
  };
}

async function changeStudentPassword(
  universityId: string,
  studentId: number,
  currentPassword: string,
  newPassword: string,
) {
  const student = await findStudent(universityId, studentId);

  if (!student || !student.passwordHash || !verifyStaffPassword(currentPassword, student.passwordHash)) {
    throw new Error('Current password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw new Error('New password must differ from the current one');
  }

  student.passwordHash = hashStaffPassword(newPassword);
  student.mustChangePassword = false;
  await student.save();

  return {
    studentId: student.studentId,
    mustChangePassword: false,
  };
}

async function readStudentOverview(universityId: string, studentId: number) {
  const student = await findStudent(universityId, studentId);

  if (!student) {
    throw new Error('University student profile not found');
  }

  const [pools, scholarships] = await Promise.all([
    scholarshipPoolRepo
      .find({
        university: universityId,
        status: 'DEPLOYED',
      })
      .select('programName contractAddress chainId'),
    studentScholarshipRepo.find({
      universityStudent: student._id,
    }),
  ]);

  return {
    studentId: student.studentId,
    email: student.email,
    eligibilityStatus: student.eligibilityStatus,
    financeStatus: student.financeStatus,
    amountWei: student.amountWei ?? null,
    mustChangePassword: student.mustChangePassword === true,
    pools: pools.map((pool: any) => ({
      poolId: String(pool._id),
      programName: pool.programName,
      contractAddress: pool.contractAddress,
      chainId: pool.chainId,
    })),
    scholarships: scholarships.map((item: any) => ({
      poolId: String(item.pool),
      walletAddress: item.walletAddress,
      status: item.status,
      encryptedNoteCid: item.encryptedNoteCid ?? null,
    })),
  };
}

export { STUDENT_LOGIN_FAILED, setStudentTemporaryPassword, studentLogin, changeStudentPassword, readStudentOverview };
