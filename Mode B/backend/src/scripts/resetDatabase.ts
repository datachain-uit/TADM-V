import { connectDatabase, disconnectDatabase } from '../config/db';
import { WithdrawalRequest } from '../models/withdrawalRequest.model';
import { StudentScholarship } from '../models/studentScholarship.model';
import { ScholarshipPool } from '../models/scholarshipPool.model';
import { UniversityStudent } from '../models/universityStudent.model';
import { UniversityStaff } from '../models/universityStaff.model';
import { University } from '../models/university.model';
import { MerkleNode } from '../models/merkleNode.model';
import { printJson } from '../utils/serviceOutput';

const MODELS = [
  WithdrawalRequest,
  StudentScholarship,
  ScholarshipPool,
  UniversityStudent,
  UniversityStaff,
  University,
  MerkleNode,
];

async function resetDatabase() {
  const connection = await connectDatabase();

  console.error('RESETTING DATABASE:', connection.name);

  const deletedDocuments: Record<string, number> = {};

  for (const model of MODELS) {
    deletedDocuments[model.collection.name] = (await model.deleteMany({})).deletedCount;
  }

  return {
    reset: true,
    storage: 'MongoDB',
    database: connection.name,
    deletedDocuments,
  };
}

export { resetDatabase };

if (require.main === module) {
  resetDatabase().then(printJson).catch(require('../cli/errorHandler').handleCliError).finally(disconnectDatabase);
}
