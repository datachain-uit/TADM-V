import { issueScholarship } from '../services/scholarship.service';
import { callWithDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runIssueScholarshipCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, studentIdRaw] = args;

  if (!universityId || !staffId || !studentIdRaw) {
    throw new Error(
      'Usage: npm run scholarship:issue -- <universityId> <staffId> <studentId> | staffId must have role STUDENT_AFFAIRS',
    );
  }

  printJson(await callWithDatabase(issueScholarship, universityId, staffId, Number(studentIdRaw)));
}

export { runIssueScholarshipCli };

if (require.main === module) {
  runIssueScholarshipCli().catch(require('./errorHandler').handleCliError);
}
