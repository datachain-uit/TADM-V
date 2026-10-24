import fs from 'fs';
import path from 'path';
import { runProver } from '../clients/prover/halo2ProverClient';
import { printJson } from '../utils/serviceOutput';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const DATASET_FILE = path.join(PROJECT_ROOT, 'experiments', 'data', 'dataset_n1.json');

const PUBLISHED_PROOF_FILE = path.join(PROJECT_ROOT, 'experiments', 'results', 'quantitative', 'proofs_n1.json');

const OUTPUT_FILE = path.join(PROJECT_ROOT, 'experiments', 'results', 'insider', 'diverted_proof_n1.json');

const UNIVERSITY_WALLET = process.env.DIVERT_TO || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function word(calldata: string, index: number): string {
  return '0x' + calldata.slice(2 + 64 * index, 2 + 64 * (index + 1));
}

function main() {
  const student = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8')).students[0];
  const published = JSON.parse(fs.readFileSync(PUBLISHED_PROOF_FILE, 'utf8'))[0];

  const note = {
    student_id: student.note.student_id,
    amount: String(student.note.amount),
    rho: String(student.note.rho),
  };

  const commitment = String(runProver('commitment', note).commitment);
  const root = String(runProver('root', { commitments: [commitment] }).root);

  if (root.toLowerCase() !== String(published.root).toLowerCase()) {
    throw new Error(`root ${root} differs from the published n = 1 root ${published.root}`);
  }

  const started = performance.now();

  const proof = runProver('prove', {
    ...note,
    expected_root: root,
    commitments: [commitment],
    merkle_index: 0,
    recipient: UNIVERSITY_WALLET,
  });

  const proveMs = performance.now() - started;

  const diverted = {
    student_index: 0,
    student_id: note.student_id,
    registered_recipient: published.address,
    diverted_recipient: UNIVERSITY_WALLET,
    commitment,
    root: String(proof.root),
    nullifier: String(proof.nullifier),
    amount: String(proof.amount),
    recipient: String(proof.recipient),
    calldata: String(proof.calldata),
    calldata_bytes: (String(proof.calldata).length - 2) / 2,
    same_nullifier_as_published: String(proof.nullifier).toLowerCase() === word(published.calldata, 1).toLowerCase(),
    prove_wall_ms: Number(proveMs.toFixed(1)),
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(diverted, null, 2) + '\n', 'utf8');

  printJson({
    output: path.relative(PROJECT_ROOT, OUTPUT_FILE).replace(/\\/g, '/'),
    root: diverted.root,
    nullifier: diverted.nullifier,
    registeredRecipient: diverted.registered_recipient,
    divertedRecipient: diverted.diverted_recipient,
    sameNullifierAsPublished: diverted.same_nullifier_as_published,
    calldataBytes: diverted.calldata_bytes,
  });
}

main();
