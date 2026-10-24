import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { privateWitnessLeakageCheck } from '../experiments/publicSurfaceAudit';

const RESULTS_DIR = path.resolve(__dirname, '../../../experiments/results/qualitative');

const DATASET_DIR = path.resolve(__dirname, '../../../experiments/data');

function latestArtifact(): string | null {
  if (!fs.existsSync(RESULTS_DIR)) {
    return null;
  }

  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => path.join(RESULTS_DIR, f))
    .sort((a: string, b: string) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return files.length > 0 ? files[0]! : null;
}

function secretsFromDataset(studentCount: number) {
  const filePath = path.join(DATASET_DIR, 'dataset_n' + studentCount + '.json');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const dataset = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  return (dataset.students || []).map((student: any) => ({
    student_id: student.student_id,
    rho: student.note ? student.note.rho : student.rho,
  }));
}

test('C-7 — the REAL artifact leaks no private witness (independent re-check)', () => {
  const filePath = latestArtifact();

  if (!filePath) {
    console.error('SKIPPED: no qualitative result file yet.' + ' Run `npm run experiment:qualitative` first.');
    return;
  }

  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const surface = artifact?.privacy?.inspectedPublicArtifact;

  assert.ok(surface, 'the artifact must contain `privacy.inspectedPublicArtifact` to re-inspect');

  const numStudents = Number(artifact?.metadata?.studentCount || 0);
  const secret = secretsFromDataset(numStudents);

  if (!secret) {
    console.error('SKIPPED: dataset_n' + numStudents + '.json not found');
    return;
  }

  const exposed: number[] = [];

  for (let i = 0; i < secret.length; i += 1) {
    const result = privateWitnessLeakageCheck(surface, secret[i]);

    if (!result.passed) {
      exposed.push(i);
    }
  }

  assert.deepEqual(
    exposed,
    [],
    'students exposed on the public surface: ' +
      exposed.slice(0, 10).join(', ') +
      ' (total ' +
      exposed.length +
      '/' +
      secret.length +
      ')',
  );
});

test('C-7 — the check really inspects something, it does not run empty', () => {
  const filePath = latestArtifact();

  if (!filePath) {
    return;
  }

  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const surface = artifact?.privacy?.inspectedPublicArtifact;
  const numStudents = Number(artifact?.metadata?.studentCount || 0);
  const secret = secretsFromDataset(numStudents);

  if (!secret) {
    return;
  }

  const result = privateWitnessLeakageCheck(surface, secret[0]);

  assert.ok(result.coverage.checkedEncodingCount > 0, 'no encoding was checked - the check is running empty');

  assert.ok(
    result.coverage.serializedBytes > 1000,
    'public surface too small (' + result.coverage.serializedBytes + ' characters) - probably not a real artifact',
  );
});

test('C-7 — a secret planted in the REAL surface must be caught', () => {
  const filePath = latestArtifact();

  if (!filePath) {
    return;
  }

  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const surface = artifact?.privacy?.inspectedPublicArtifact;
  const numStudents = Number(artifact?.metadata?.studentCount || 0);
  const secret = secretsFromDataset(numStudents);

  if (!secret) {
    return;
  }

  const readableSurface = {
    ...surface,
    auditTrailReference: String(secret[0].rho),
  };

  const result = privateWitnessLeakageCheck(readableSurface, secret[0]);

  assert.equal(
    result.passed,
    false,
    '`rho` planted in the real surface but the check still reports clean' + ' - the check cannot be trusted',
  );
});
