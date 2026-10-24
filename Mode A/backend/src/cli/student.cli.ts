import { createStudentProfile, approveEligibility, approveFinance } from '../services/student.service';
import { registerStudentWallet } from '../services/studentWallet.service';
import { setStudentTemporaryPassword } from '../services/studentAccount.service';
import { callWithDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runCreateStudentCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, studentIdRaw, email] = args;

  if (!universityId || !staffId || !studentIdRaw || !email) {
    throw new Error(
      'Usage: npm run student:create -- <universityId> <staffId> <studentId> <email>' +
        ' | staffId must have role STUDENT_AFFAIRS',
    );
  }

  printJson(await callWithDatabase(createStudentProfile, universityId, staffId, Number(studentIdRaw), email));
}

async function runEligibilityCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, studentIdRaw, decision] = args;

  if (!universityId || !staffId || !studentIdRaw || (decision !== 'approve' && decision !== 'reject')) {
    throw new Error(
      'Usage: npm run student:eligibility -- <universityId> <staffId> <studentId> <approve|reject>' +
        ' | staffId must have role STUDENT_AFFAIRS',
    );
  }

  printJson(await callWithDatabase(approveEligibility, universityId, staffId, Number(studentIdRaw), decision));
}

async function runFinanceCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, studentIdRaw, amountWei] = args;

  if (!universityId || !staffId || !studentIdRaw || !amountWei) {
    throw new Error(
      'Usage: npm run student:finance -- <universityId> <staffId> <studentId> <amountWei>' +
        ' | staffId must have role FINANCE',
    );
  }

  printJson(await callWithDatabase(approveFinance, universityId, staffId, Number(studentIdRaw), amountWei));
}

async function runWalletCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, poolId, email, walletAddress, publicKey] = args;

  if (!universityId || !staffId || !poolId || !email || !walletAddress || !publicKey) {
    throw new Error(
      'Usage: npm run student:wallet -- <universityId> <staffId> <poolId> <email> <wallet> <publicKey>' +
        ' | staffId must have role STUDENT_AFFAIRS' +
        ' | poolId: a university may run several programs, so name the one to register into',
    );
  }

  printJson(
    await callWithDatabase(registerStudentWallet, universityId, staffId, poolId, email, walletAddress, publicKey),
  );
}

async function runPasswordCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, studentIdRaw, temporaryPassword] = args;

  if (!universityId || !staffId || !studentIdRaw || !temporaryPassword) {
    throw new Error(
      'Usage: npm run student:password -- <universityId> <staffId> <studentId> <temporaryPassword>' +
        ' | staffId must have role STUDENT_AFFAIRS' +
        ' | temporary password: at least 8 characters; the student must change it at first login',
    );
  }

  printJson(
    await callWithDatabase(setStudentTemporaryPassword, universityId, staffId, Number(studentIdRaw), temporaryPassword),
  );
}

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  create: runCreateStudentCli,
  eligibility: runEligibilityCli,
  finance: runFinanceCli,
  wallet: runWalletCli,
  password: runPasswordCli,
};

async function runStudentCli(argv: string[] = process.argv.slice(2)) {
  const [subcommand, ...rest] = argv;
  const handler = subcommand ? SUBCOMMANDS[subcommand] : undefined;

  if (!handler) {
    throw new Error('Usage: npx ts-node src/cli/student.cli.ts <create|eligibility|finance|wallet|password> ...');
  }

  await handler(rest);
}

export { runStudentCli, runCreateStudentCli, runEligibilityCli, runFinanceCli, runWalletCli, runPasswordCli };

if (require.main === module) {
  runStudentCli().catch(require('./errorHandler').handleCliError);
}
