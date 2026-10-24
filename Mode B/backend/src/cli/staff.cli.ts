import { createUniversityStaff, setStaffPassword, staffLogin } from '../services/staff.service';
import { callWithDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runCreateUniversityStaffCli(args: string[] = process.argv.slice(2)) {
  const [universityId, actingStaffId, staffId, role] = args;

  if (!universityId || !actingStaffId || !staffId || (role !== 'STUDENT_AFFAIRS' && role !== 'FINANCE')) {
    throw new Error(
      'Usage: npm run staff:create -- <universityId> <actingStaffId> <staffId> <STUDENT_AFFAIRS|FINANCE>' +
        ' | actingStaffId = an existing staff member who vouches for the new one',
    );
  }

  printJson(await callWithDatabase(createUniversityStaff, universityId, actingStaffId, staffId, role));
}

async function runSetStaffPasswordCli(args: string[] = process.argv.slice(2)) {
  const [universityId, actingStaffId, staffId, password] = args;

  if (!universityId || !actingStaffId || !staffId || !password) {
    throw new Error(
      'Usage: npm run staff:password -- <universityId> <actingStaffId> <staffId> <password>' +
        ' | actingStaffId = an existing staff member | password: at least 8 characters',
    );
  }

  printJson(await callWithDatabase(setStaffPassword, universityId, actingStaffId, staffId, password));
}

async function runStaffLoginCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, password] = args;

  if (!universityId || !staffId || !password) {
    throw new Error('Usage: npm run staff:login -- <universityId> <staffId> <password>');
  }

  printJson(await callWithDatabase(staffLogin, universityId, staffId, password));
}

export { runCreateUniversityStaffCli, runSetStaffPasswordCli, runStaffLoginCli };

if (require.main === module) {
  runCreateUniversityStaffCli().catch(require('./errorHandler').handleCliError);
}
