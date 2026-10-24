import {
  createScholarshipPool,
  deployScholarshipPool,
  fundPool,
  recordSponsorFunding,
  readPoolBalance,
} from '../services/pool.service';
import { callWithDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runCreatePoolCli(args: string[] = process.argv.slice(2)) {
  const [universityId, staffId, ...rest] = args;

  if (!universityId || !staffId) {
    throw new Error(
      'Usage: npm run pool:create -- <universityId> <staffId> [programName] | staffId must have role FINANCE',
    );
  }

  const programName = rest.join(' ').trim() || undefined;

  printJson(await callWithDatabase(createScholarshipPool, universityId, staffId, programName));
}

async function runDeployPoolCli(args: string[] = process.argv.slice(2)) {
  const [poolId, staffId, initialFundingWei = '0'] = args;

  if (!poolId || !staffId) {
    throw new Error(
      'Usage: npm run pool:deploy -- <poolId> <staffId> [initialFundingWei] | staffId must have role FINANCE',
    );
  }

  printJson(await callWithDatabase(deployScholarshipPool, poolId, staffId, initialFundingWei));
}

async function runFundPoolCli(args: string[] = process.argv.slice(2)) {
  const [poolId, staffId, amountWei, sponsorAddress] = args;

  if (!poolId || !staffId || !amountWei || !sponsorAddress) {
    throw new Error(
      'Usage: npm run pool:fund -- <poolId> <staffId> <amountWei> <sponsorAddress> | staffId must have role FINANCE',
    );
  }

  printJson(await callWithDatabase(fundPool, poolId, staffId, amountWei, sponsorAddress));
}

async function runRecordFundingCli(args: string[] = process.argv.slice(2)) {
  const [poolId, staffId, transactionHash] = args;

  if (!poolId || !staffId || !transactionHash) {
    throw new Error(
      'Usage: npm run pool:fund-record -- <poolId> <staffId> <transactionHash> | staffId must have role FINANCE',
    );
  }

  printJson(await callWithDatabase(recordSponsorFunding, poolId, staffId, transactionHash));
}

async function runPoolBalanceCli(args: string[] = process.argv.slice(2)) {
  const [poolId] = args;

  if (!poolId) {
    throw new Error('Usage: npm run pool:balance -- <poolId>');
  }

  printJson(await callWithDatabase(readPoolBalance, poolId));
}

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  create: runCreatePoolCli,
  deploy: runDeployPoolCli,
  fund: runFundPoolCli,
  'fund-record': runRecordFundingCli,
  balance: runPoolBalanceCli,
};

async function runPoolCli(argv: string[] = process.argv.slice(2)) {
  const [subcommand, ...rest] = argv;
  const handler = subcommand ? SUBCOMMANDS[subcommand] : undefined;

  if (!handler) {
    throw new Error('Usage: npx ts-node src/cli/pool.cli.ts <create|deploy|fund|fund-record|balance> ...');
  }

  await handler(rest);
}

export { runPoolCli, runCreatePoolCli, runDeployPoolCli, runFundPoolCli, runRecordFundingCli, runPoolBalanceCli };

if (require.main === module) {
  runPoolCli().catch(require('./errorHandler').handleCliError);
}
