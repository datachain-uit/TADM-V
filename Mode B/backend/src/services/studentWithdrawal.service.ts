import mongoose from 'mongoose';
import * as universityStudentRepo from '../repositories/universityStudent.repo';
import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import { createWithdrawalRequest } from './withdrawalRequest.service';
import { readEncryptedNote } from '../clients/ipfs/encryptedNoteStorage';

async function findOwnStudent(universityId: string, studentId: number) {
  const student = await universityStudentRepo.findOne({
    university: universityId,
    studentId,
  });

  if (!student) {
    throw new Error('University student profile not found');
  }

  return student;
}

async function readOwnEncryptedNote(universityId: string, studentId: number, poolId: string) {
  if (!mongoose.isValidObjectId(poolId)) {
    throw new Error('Invalid scholarship pool id');
  }

  const student = await findOwnStudent(universityId, studentId);
  const scholarship = await studentScholarshipRepo.findOne({
    pool: poolId,
    universityStudent: student._id,
  });

  if (!scholarship || !scholarship.encryptedNoteCid) {
    throw new Error('No issued scholarship note for you in this program yet');
  }

  const envelope = await readEncryptedNote(scholarship.encryptedNoteCid);

  return {
    cid: scholarship.encryptedNoteCid,
    envelope: {
      version: envelope.version,
      ephemeralPublicKey: envelope.ephemeralPublicKey,
      iv: envelope.iv,
      authTag: envelope.authTag,
      ciphertext: envelope.ciphertext,
    },
  };
}

async function submitOwnWithdrawal(universityId: string, studentId: number, submission: any) {
  const cid = submission?.cid;

  if (typeof cid !== 'string' || cid.length === 0) {
    throw new Error('Input must contain cid');
  }

  const student = await findOwnStudent(universityId, studentId);
  const ownScholarship = await studentScholarshipRepo.findOne({
    encryptedNoteCid: cid,
    universityStudent: student._id,
  });

  if (!ownScholarship) {
    throw new Error('This note is not for one of your scholarships');
  }

  return createWithdrawalRequest(submission);
}

export { readOwnEncryptedNote, submitOwnWithdrawal };
