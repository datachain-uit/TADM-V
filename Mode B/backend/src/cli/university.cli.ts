import { createUniversity } from '../services/university.service';
import { callWithDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runCreateUniversityCli(args: string[] = process.argv.slice(2)) {
  const [name, walletAddress] = args;

  if (!name || !walletAddress) {
    throw new Error('Usage: npm run university:create -- <name> <walletAddress>');
  }

  printJson(await callWithDatabase(createUniversity, name, walletAddress));
}

export { runCreateUniversityCli };

if (require.main === module) {
  runCreateUniversityCli().catch(require('./errorHandler').handleCliError);
}
