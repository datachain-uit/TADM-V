import fs from 'fs';
import path from 'path';
import { runQualitativeExperiment } from '../experiments/qualitativeExperiment';
import { disconnectDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';

async function runQualitativeExperimentCli(args: string[] = process.argv.slice(2)) {
  const [configurationPath] = args;

  if (!configurationPath) {
    throw new Error('Usage: npm run experiment:qualitative -- <configuration.json>');
  }

  const config = JSON.parse(fs.readFileSync(path.resolve(configurationPath), 'utf8'));
  let output: any;

  try {
    output = await runQualitativeExperiment(config);
  } finally {
    await disconnectDatabase();
  }

  printJson({ outputPath: output.outputPath, csvPaths: output.csvPaths });
}

export { runQualitativeExperimentCli };

if (require.main === module) {
  runQualitativeExperimentCli().catch(require('./errorHandler').handleCliError);
}
