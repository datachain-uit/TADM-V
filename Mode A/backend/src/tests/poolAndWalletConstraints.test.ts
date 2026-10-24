import test from 'node:test';
import assert from 'node:assert/strict';
import { ScholarshipPool } from '../models/scholarshipPool.model';
import { StudentScholarship } from '../models/studentScholarship.model';

function findSchemaIndex(schema: any, key: string[]) {
  return schema.indexes().find(([fields]: [Record<string, unknown>]) => {
    const name = Object.keys(fields);

    return name.length === key.length && key.every((k) => name.includes(k));
  });
}

test('A19 — one university may open SEVERAL scholarship programs', () => {
  const universityField = ScholarshipPool.schema.path('university');

  assert.equal(
    Boolean(universityField?.options?.unique),
    false,
    '`university` must NOT be unique - otherwise each university gets' + ' only one pool and A19 breaks',
  );

  const compound = findSchemaIndex(ScholarshipPool.schema, ['university', 'programName']);

  assert.ok(compound, 'a compound index {university, programName} is required');

  assert.equal(
    compound[1]?.unique,
    true,
    'the compound index must be unique - otherwise one university can create two' + ' programs with the SAME NAME',
  );
});

test('A19 — programName is a required field with a default', () => {
  const field = ScholarshipPool.schema.path('programName');

  assert.ok(field, 'the `programName` field is required');

  assert.equal(field.isRequired, true, '`programName` must be required');

  assert.ok(field.defaultValue, '`programName` must have a default so existing callers do not break');
});

test('A21 — a wallet may be used for EXACTLY ONE scholarship, globally', () => {
  const globalIndex = findSchemaIndex(StudentScholarship.schema, ['walletAddress']);

  assert.ok(
    globalIndex,
    'a GLOBAL index on `walletAddress` is required - an index' + ' on {pool, walletAddress} is NOT ENOUGH',
  );

  assert.equal(globalIndex[1]?.unique, true, 'the global index must be unique, otherwise it blocks nothing');
});

test('A21 — the block is PERMANENT, independent of pool status', () => {
  const globalIndex = findSchemaIndex(StudentScholarship.schema, ['walletAddress']);

  assert.equal(
    globalIndex[1]?.partialFilterExpression,
    undefined,
    'the global index must not filter by status - old on-chain' + ' events do not disappear when a pool closes',
  );
});
