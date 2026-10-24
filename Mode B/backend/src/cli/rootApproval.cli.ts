import { approveRoot } from '../services/rootApproval.service';
import { callWithDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runApproveRootCli(args: string[] = process.argv.slice(2)) {
  const [poolId, staffId] = args;

  if (!poolId || !staffId) {
    throw new Error('Usage: npm run root:approve -- <poolId> <staffId> | staffId must have role STUDENT_AFFAIRS');
  }

  printJson(await callWithDatabase(approveRoot, poolId, staffId));
}

export { runApproveRootCli };

if (require.main === module) {
  runApproveRootCli().catch(require('./errorHandler').handleCliError);
}
