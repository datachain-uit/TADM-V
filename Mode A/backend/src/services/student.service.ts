import { authorizeStaff, ROLE_LABEL, authorizeAnyStaff } from './staffAuthorization.service';
import * as universityRepo from '../repositories/university.repo';
import * as universityStudentRepo from '../repositories/universityStudent.repo';

function isPositiveStudentId(studentId: number) {
  return Number.isSafeInteger(studentId) && studentId > 0;
}

function presentStudent(student: any) {
  return {
    universityId: String(student.university),
    studentId: student.studentId,
    email: student.email,
    eligibilityStatus: student.eligibilityStatus,
    financeStatus: student.financeStatus,
    amountWei: student.amountWei ?? null,
  };
}

async function createStudentProfile(universityId: string, staffId: string, studentId: number, email: string) {
  if (!universityId || !staffId || !isPositiveStudentId(studentId) || !email) {
    throw new Error('A universityId, staffId, positive studentId and email are required');
  }

  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    throw new Error('Invalid student email');
  }

  await authorizeStaff(universityId, staffId, 'STUDENT_AFFAIRS');

  const normalizedEmail = email.trim().toLowerCase();
  const university = await universityRepo.findOne({ _id: universityId, status: 'ACTIVE' });

  if (!university) {
    throw new Error('Active university not found');
  }

  const existing = await universityStudentRepo.findOne({
    $or: [
      { university: university._id, studentId },
      { university: university._id, email: normalizedEmail },
    ],
  });

  if (existing) {
    throw new Error('Student profile already exists');
  }

  const student = await universityStudentRepo.create({
    university: university._id,
    studentId,
    email: normalizedEmail,
    eligibilityStatus: 'PENDING',
    financeStatus: 'PENDING',
  });

  return presentStudent(student);
}

async function approveEligibility(
  universityId: string,
  staffId: string,
  studentId: number,
  decision: 'approve' | 'reject',
) {
  if (!universityId || !staffId || !isPositiveStudentId(studentId) || !['approve', 'reject'].includes(decision)) {
    throw new Error('A universityId, staffId, positive studentId and approve|reject decision are required');
  }

  const staff = await authorizeStaff(universityId, staffId, 'STUDENT_AFFAIRS');
  const student = await universityStudentRepo.findOne({ university: universityId, studentId });

  if (!student) {
    throw new Error('University student profile not found');
  }

  if (decision === 'approve') {
    student.eligibilityStatus = 'ELIGIBLE';
    student.eligibilityApprovedAt = new Date();
  } else {
    student.eligibilityStatus = 'REJECTED';
    student.financeStatus = 'REJECTED';
    student.amountWei = undefined;
  }

  await student.save();
  console.error('reviewed by:', staff.staffId, '-', ROLE_LABEL[staff.role]);

  return presentStudent(student);
}

async function approveFinance(universityId: string, staffId: string, studentId: number, amountWei: string) {
  if (!universityId || !staffId || !isPositiveStudentId(studentId) || !/^[1-9][0-9]*$/.test(String(amountWei))) {
    throw new Error('A universityId, staffId, positive studentId and positive amountWei are required');
  }

  const staff = await authorizeStaff(universityId, staffId, 'FINANCE');
  const student = await universityStudentRepo.findOne({ university: universityId, studentId });

  if (!student) {
    throw new Error('University student profile not found');
  }

  if (student.eligibilityStatus !== 'ELIGIBLE') {
    throw new Error('Student must be ELIGIBLE before finance approval');
  }

  student.amountWei = amountWei;
  student.financeStatus = 'APPROVED';
  student.financeApprovedAt = new Date();
  await student.save();
  console.error('reviewed by:', staff.staffId, '-', ROLE_LABEL[staff.role]);

  return presentStudent(student);
}

async function listUniversityStudents(universityId: string, staffId: string) {
  await authorizeAnyStaff(universityId, staffId);

  const students = await universityStudentRepo.find({ university: universityId }).sort({ studentId: 1 });

  return students.map((item: any) => ({
    studentId: item.studentId,
    email: item.email,
    eligibilityStatus: item.eligibilityStatus,
    financeStatus: item.financeStatus,
    amountWei: item.amountWei ?? null,
    hasPassword: Boolean(item.passwordHash),
    mustChangePassword: item.mustChangePassword === true,
  }));
}

export { createStudentProfile, approveEligibility, approveFinance, listUniversityStudents };
