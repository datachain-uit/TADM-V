import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { runProver } from '../clients/prover/halo2ProverClient';
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

  const students: any[] = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8')).students;

  const notes = students.map((student: any) => ({
    student_id: student.note.student_id,
    amount: String(student.note.amount),
    rho: String(student.note.rho),
  }));

  console.error(`Computing ${notes.length} commitments ...`);

  const commitments = notes.map((note) => String(runProver('commitment', note).commitment));
  const root = String(runProver('root', { commitments }).root);

  const recipients = students.map((student: any) => ({
    student_index: student.student_index,
    student_id: student.note.student_id,
    published_address: student.address,
    fresh_address: ethers.Wallet.createRandom().address,
  }));

  console.error(`Proving ${notes.length} students with fresh recipient wallets (one process, keys generated once) ...`);

  const started = performance.now();

  const batch = runProver(
    'prove-batch',
    notes.map((note, i) => ({
      ...note,
      expected_root: root,
      commitments,
      merkle_index: i,
      recipient: recipients[i]!.fresh_address,
    })),
  );

  const wallMs = performance.now() - started;

  const proofs = batch.proofs.map((item: any) => ({
    student_index: item.student_index,
    address: recipients[item.student_index]!.fresh_address,
    amountWei: BigInt(item.amount).toString(),
    proof: item.proof,
    root: item.root,
    nullifier: item.nullifier,
    amount: item.amount,
    recipient: item.recipient,
    prove_ms: item.prove_ms,
    verify_ms: item.verify_native_ms,
    verified: item.verified,
    proof_bytes: item.proof_bytes,
  }));

  if (proofs.some((p: any) => String(p.root).toLowerCase() !== root.toLowerCase() || p.verified !== true)) {
    throw new Error('a fresh-recipient proof does not carry the dataset root or failed native verification');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(RECIPIENTS_FILE, JSON.stringify(recipients, null, 2) + '\n', 'utf8');
  fs.writeFileSync(PROOFS_FILE, JSON.stringify(proofs, null, 2) + '\n', 'utf8');

  printJson({
    recipients: path.relative(PROJECT_ROOT, RECIPIENTS_FILE).replace(/\\/g, '/'),
    proofs: path.relative(PROJECT_ROOT, PROOFS_FILE).replace(/\\/g, '/'),
    students: proofs.length,
    root,
    allVerified: true,
    batchWallMs: Number(wallMs.toFixed(0)),
  });
}

main();
