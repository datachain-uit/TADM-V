import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { ethers } from 'ethers';
import { proverBinary } from '../clients/prover/halo2ProverClient';
import { printJson } from '../utils/serviceOutput';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const N = 500;

const DATASET_FILE = path.join(PROJECT_ROOT, 'experiments', 'data', `dataset_n${N}.json`);

const OUTPUT_DIR = path.join(PROJECT_ROOT, 'experiments', 'results', 'sepolia');

const RECIPIENTS_FILE = path.join(OUTPUT_DIR, `fresh_recipients_n${N}.json`);

const PROOFS_FILE = path.join(OUTPUT_DIR, `proofs_fresh_recipients_n${N}.json`);

function main() {
  if (fs.existsSync(PROOFS_FILE) && process.env.FORCE_RERUN !== '1') {
    throw new Error(`${PROOFS_FILE} already exists — set FORCE_RERUN=1 to replace it`);
  }

  const dataset = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8'));

  const recipients = dataset.students.map((student: any) => ({
    student_index: student.student_index,
    student_id: student.note.student_id,
    published_address: student.address,
    fresh_address: ethers.Wallet.createRandom().address,
  }));

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-recipient-proofs-'));
  const workDataset = path.join(workDir, `dataset_n${N}.json`);

  fs.writeFileSync(
    workDataset,
    JSON.stringify(
      {
        ...dataset,
        students: dataset.students.map((student: any, i: number) => ({
          ...student,
          address: recipients[i].fresh_address,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.error(`Proving ${N} students with fresh recipient wallets (bench-from-dataset, keys generated once) ...`);

  const started = performance.now();

  const result = spawnSync(proverBinary(), ['bench-from-dataset', workDataset], {
    cwd: path.join(PROJECT_ROOT, 'prover'),
    env: { ...process.env, BENCH_OUT_DIR: workDir, BENCH_WARMUP: '0' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`bench-from-dataset failed (exit ${result.status}):\n${result.stderr}`);
  }

  const wallMs = performance.now() - started;

  const proofs: any[] = JSON.parse(fs.readFileSync(path.join(workDir, `proofs_n${N}.json`), 'utf8'));

  if (proofs.length !== N) {
    throw new Error(`expected ${N} proofs, got ${proofs.length}`);
  }

  for (const proof of proofs) {
    const expected = recipients[proof.student_index].fresh_address;

    if (String(proof.address) !== expected || BigInt(proof.recipient) !== BigInt(expected)) {
      throw new Error(`proof ${proof.student_index} does not carry its fresh recipient wallet`);
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(RECIPIENTS_FILE, JSON.stringify(recipients, null, 2) + '\n', 'utf8');
  fs.writeFileSync(PROOFS_FILE, JSON.stringify(proofs, null, 2) + '\n', 'utf8');
  fs.rmSync(workDir, { recursive: true, force: true });

  printJson({
    recipients: path.relative(PROJECT_ROOT, RECIPIENTS_FILE).replace(/\\/g, '/'),
    proofs: path.relative(PROJECT_ROOT, PROOFS_FILE).replace(/\\/g, '/'),
    students: proofs.length,
    root: proofs[0].root,
    batchWallMs: Number(wallMs.toFixed(0)),
  });
}

main();
