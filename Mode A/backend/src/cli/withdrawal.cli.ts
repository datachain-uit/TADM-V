import fs from 'fs';
import { createWithdrawalRequest } from '../services/withdrawalRequest.service';
import { reviewWithdrawalRequest, reviewWithdrawalBatch } from '../services/withdrawalReview.service';
import { callWithDatabase } from '../config/db';
import { readJsonInput } from '../utils/jsonInput';
import { printJson } from '../utils/serviceOutput';

async function runCreateWithdrawalRequestCli(args: string[] = process.argv.slice(2)) {
  printJson(await callWithDatabase(createWithdrawalRequest, readJsonInput(args[0])));
}

async function runReviewWithdrawalRequestCli(args: string[] = process.argv.slice(2)) {
  const [requestId, staffId, decision] = args;

  if (!requestId || !staffId || (decision !== 'approve' && decision !== 'reject')) {
    throw new Error(
      'Usage: npm run withdrawal:review -- <requestId> <staffId> <approve|reject> | staffId must have role FINANCE',
    );
  }

  printJson(await callWithDatabase(reviewWithdrawalRequest, requestId, staffId, decision));
}

function readRequestIdsFromStdin(): string[] {
  try {
    return String(fs.readFileSync(0, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function runReviewWithdrawalBatchCli(args: string[] = process.argv.slice(2)) {
  const [staffId, decision, ...argvIds] = args;
  const requestIds = argvIds.length > 0 ? argvIds : readRequestIdsFromStdin();

  if (!staffId || (decision !== 'approve' && decision !== 'reject') || requestIds.length === 0) {
    throw new Error(
      'Usage: npm run withdrawal:review-batch -- <staffId> <approve|reject> <requestId...>' +
        ' | or pipe the request ids on stdin, one per line | staffId must have role FINANCE',
    );
  }

  printJson(await callWithDatabase(reviewWithdrawalBatch, requestIds, staffId, decision));
}

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  create: runCreateWithdrawalRequestCli,
  review: runReviewWithdrawalRequestCli,
  'review-batch': runReviewWithdrawalBatchCli,
};

async function runWithdrawalCli(argv: string[] = process.argv.slice(2)) {
  const [subcommand, ...rest] = argv;
  const handler = subcommand ? SUBCOMMANDS[subcommand] : undefined;

  if (!handler) {
    throw new Error('Usage: npx ts-node src/cli/withdrawal.cli.ts <create|review|review-batch> ...');
  }

  await handler(rest);
}

export { runWithdrawalCli, runCreateWithdrawalRequestCli, runReviewWithdrawalRequestCli, runReviewWithdrawalBatchCli };

if (require.main === module) {
  runWithdrawalCli().catch(require('./errorHandler').handleCliError);
}
