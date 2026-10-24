import { authorizeStaff } from './staffAuthorization.service';
import { computeCommitment } from './zkProof.service';
import * as universityStudentRepo from '../repositories/universityStudent.repo';
import * as studentScholarshipRepo from '../repositories/studentScholarship.repo';
import '../repositories/scholarshipPool.repo';
import { createStudentNote } from '../clients/ipfs/noteEncryption';
import { uploadToIpfs } from '../clients/ipfs/encryptedNoteStorage';
import { universityIdOf } from '../utils/universityRef';

const MERKLE_DEPTH = 9;

const MAX_LEAVES = 1 << MERKLE_DEPTH;

async function issueScholarship(universityId: string, staffId: string, studentId: number, rho?: string) {
  if (!universityId || !staffId || !Number.isSafeInteger(studentId) || studentId <= 0) {
    throw new Error('A universityId, staffId and positive studentId are required');
  }

  await authorizeStaff(universityId, staffId, 'STUDENT_AFFAIRS');

  const universityStudent = await universityStudentRepo.findOne({ university: universityId, studentId });

  if (!universityStudent) {
    throw new Error('University student profile not found');
  }

  if (universityStudent.eligibilityStatus !== 'ELIGIBLE') {
    throw new Error(
      `Student has not been approved by Student Affairs. Current eligibilityStatus: ${universityStudent.eligibilityStatus}`,
    );
  }

  if (universityStudent.financeStatus !== 'APPROVED' || !universityStudent.amountWei) {
    throw new Error(
      `Scholarship amount has not been approved by Finance. Current financeStatus: ${universityStudent.financeStatus}`,
    );
  }

  const scholarship = await studentScholarshipRepo
    .findOne({ universityStudent: universityStudent._id })
    .populate('pool');

  if (!scholarship) {
    throw new Error('Student has not registered wallet and public key');
  }

  const pool = scholarship.pool as any;

  if (!pool || pool.status !== 'DEPLOYED' || universityIdOf(pool.university) !== String(universityId)) {
    throw new Error('Student scholarship is not assigned to a deployed pool of this university');
  }

  if (scholarship.status !== 'WALLET_REGISTERED') {
    throw new Error(
      `Student scholarship status must be WALLET_REGISTERED before issuing a note. Current status: ${scholarship.status}`,
    );
  }

  if (scholarship.commitment || scholarship.encryptedNoteCid) {
    throw new Error('Scholarship note has already been issued');
  }

  if (!scholarship.publicKey) {
    throw new Error('Student public key is missing');
  }

  const lastScholarship = await studentScholarshipRepo
    .findOne({ pool: pool._id, merkleIndex: { $exists: true, $ne: null } })
    .sort({ merkleIndex: -1 });
  const merkleIndex = lastScholarship ? Number(lastScholarship.merkleIndex) + 1 : 0;

  if (merkleIndex >= MAX_LEAVES) {
    throw new Error(`Current Merkle depth is ${MERKLE_DEPTH}, so only ${MAX_LEAVES} leaves are supported`);
  }

  const note = createStudentNote(universityStudent.studentId, universityStudent.amountWei, rho);
  const commitment = computeCommitment(note);
  const encryptedNoteCid = await uploadToIpfs(note, scholarship.publicKey);

  scholarship.encryptedNoteCid = encryptedNoteCid;
  scholarship.commitment = commitment;
  scholarship.merkleIndex = merkleIndex;
  scholarship.status = 'NOTE_CREATED';
  await scholarship.save();

  return {
    scholarshipId: String(scholarship._id),
    poolId: String(pool._id),
    studentId: universityStudent.studentId,
    merkleIndex,
    commitment,
    encryptedNoteCid,
    status: scholarship.status,
  };
}

export { issueScholarship };
