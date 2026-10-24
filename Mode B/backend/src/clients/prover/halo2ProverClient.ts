import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function projectRoot() {
  return path.resolve(__dirname, '../../../..');
}

function proverBinary() {
  return process.env.PROVER_BIN
    ? path.resolve(process.env.PROVER_BIN)
    : path.join(projectRoot(), 'target', 'release', process.platform === 'win32' ? 'prover.exe' : 'prover');
}

function parseJsonOutput(stdout: string) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index] as string);
    } catch (_) {}
  }
  throw new Error('Prover stdout did not contain JSON');
}

function runProver(mode: 'commitment' | 'nullifier' | 'root' | 'prove' | 'rho', payload: unknown) {
  if (!fs.existsSync(proverBinary())) {
    throw new Error(`Missing release prover at ${proverBinary()}; run cargo build --release -p prover`);
  }
  const result = spawnSync(proverBinary(), [mode], {
    cwd: path.join(projectRoot(), 'prover'),
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Halo2 prover ${mode} failed (exit ${result.status}):\n${result.stderr}`);
  }
  return parseJsonOutput(result.stdout);
}

export { projectRoot, proverBinary, parseJsonOutput, runProver };
