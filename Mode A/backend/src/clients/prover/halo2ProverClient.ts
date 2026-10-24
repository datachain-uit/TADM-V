import { spawnSync } from 'child_process';
import path from 'path';

type ProverMode =
  'setup' | 'commitment' | 'nullifier' | 'root' | 'prove' | 'verify' | 'rho' | 'pk' | 'check-k' | 'prove-batch';

function proverBinary(): string {
  return path.resolve(__dirname, '../../../../target/release/prover.exe');
}

function runProver(mode: ProverMode, payload: any) {
  const result = spawnSync(proverBinary(), [mode], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error('RUST STDERR:', result.stderr);
    throw new Error(`Rust ${mode} mode failed`);
  }

  if (result.stderr) {
    console.error('RUST STDERR:', result.stderr);
  }

  const stdout = result.stdout.trim();

  if (!stdout) {
    throw new Error(`Rust ${mode} mode returned empty stdout`);
  }

  return JSON.parse(stdout);
}

export { proverBinary, runProver };
