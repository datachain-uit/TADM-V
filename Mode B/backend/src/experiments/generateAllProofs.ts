import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const SCENARIOS = [1, 10, 30, 60, 100, 500];

function getProjectRoot() {
  return path.resolve(__dirname, '../../..');
}

function getProverDir() {
  return path.resolve(getProjectRoot(), 'prover');
}

function getProverPath() {
  return path.resolve(
    getProjectRoot(),
    process.platform === 'win32' ? 'target/release/prover.exe' : 'target/release/prover',
  );
}

function runProverCommand(args: string[]) {
  console.log('\nRunning prover:', getProverPath(), args.join(' '));

  const result = spawnSync(getProverPath(), args, {
    cwd: getProverDir(),
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Prover command failed: ${args.join(' ')}`);
  }
}

const EXPECTED_CALLDATA_BYTES = 4352;

function scenarioAlreadyDone(n: number) {
  const file = path.resolve(getProjectRoot(), 'experiments/results/quantitative', `proofs_n${n}.json`);

  if (!fs.existsSync(file)) {
    return false;
  }

  let calldataBytes = 0;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

    const list = Array.isArray(parsed) ? parsed : parsed.proofs;

    const first = list && list[0];
    const blob = String((first && (first.calldata || first.proof)) || '');

    calldataBytes = blob.replace(/^0x/, '').length / 2;
  } catch (error) {
    console.log(`  n = ${n}: cannot read ${file} -> REGENERATING`);
    return false;
  }

  if (calldataBytes !== EXPECTED_CALLDATA_BYTES) {
    console.log(
      `  n = ${n}: calldata ${calldataBytes} B != ` +
        `${EXPECTED_CALLDATA_BYTES} B (current configuration)` +
        ' -> STALE file, REGENERATING',
    );
    return false;
  }

  console.log(
    `  SKIP n = ${n} — proofs for the current configuration already exist` +
      ` (calldata ${calldataBytes} B).` +
      ` Delete proofs_n${n}.json to regenerate.`,
  );

  return true;
}

function main() {
  runProverCommand(['export-verifier-from-dataset', '../experiments/data/dataset_n100.json']);

  for (const n of SCENARIOS) {
    if (scenarioAlreadyDone(n)) {
      continue;
    }

    runProverCommand(['bench-from-dataset', `../experiments/data/dataset_n${n}.json`]);
  }
}

main();
