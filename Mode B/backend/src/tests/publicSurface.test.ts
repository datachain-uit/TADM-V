import test from 'node:test';
import assert from 'node:assert/strict';
const artifact = require('../../../contracts/artifacts/' + 'contracts/ShieldedPool.sol/ShieldedPool.json');
import { privateWitnessLeakageCheck } from '../experiments/publicSurfaceAudit';

test('withdraw ABI binds proof and excludes private witnesses', () => {
  const withdraw = artifact.abi.find((item: any) => item.type === 'function' && item.name === 'withdraw');
  const serializedPublicSurface = JSON.stringify(artifact.abi);

  assert.deepEqual(
    withdraw.inputs.map((input: any) => input.name),
    ['proofAndSignals', 'root', 'nullifier', 'recipient', 'amount'],
  );

  assert.equal(
    withdraw.inputs.some((input: any) => input.name === 'proofAndSignals'),
    true,
  );

  for (const privateName of ['student_id', 'rho', 'siblings', 'directions']) {
    assert.equal(serializedPublicSurface.includes(privateName), false);
  }
});

test('verifier is a separate on-chain contract', () => {
  const verifier = artifact.abi.find((item: any) => item.type === 'function' && item.name === 'verifier');

  assert.notEqual(verifier, undefined);
});

test('qualitative artifact audit detects private field names', () => {
  const clean = privateWitnessLeakageCheck({
    proofOutput: {
      root: '0x01',
      nullifier: '0x02',
      amount: '10',
    },
  });

  assert.equal(clean.passed, true);
  assert.deepEqual(clean.exposedNames, []);

  const leaked = privateWitnessLeakageCheck({ rho: 'private' });

  assert.equal(leaked.passed, false);
  assert.deepEqual(leaked.exposedNames, ['rho']);
});

test('audit detects a private VALUE hidden under an innocent name', () => {
  const rho = '8123456789012345678901234567890123456789012345678901234567890123';
  const audit = privateWitnessLeakageCheck({ proofOutput: { memo: rho } }, { rho });

  assert.equal(audit.passed, false);
  assert.deepEqual(audit.exposedNames, []);
  assert.equal(audit.exposedValues.length > 0, true);
  assert.equal(audit.exposedValues[0]!.label, 'rho');
});

test('audit finds a private value written in a different encoding', () => {
  const rhoDecimal = '123456789012345678901234567890';
  const asPaddedHex = '0x' + BigInt(rhoDecimal).toString(16).padStart(64, '0');
  const audit = privateWitnessLeakageCheck({ events: [{ data: asPaddedHex }] }, { rho: rhoDecimal });

  assert.equal(audit.passed, false);
  assert.equal(audit.exposedValues.length > 0, true);
});

test('audit reports what it could NOT check', () => {
  const audit = privateWitnessLeakageCheck({ proofOutput: { root: '0xabcdef0123456789' } }, { student_id: 1 });

  assert.equal(audit.coverage.skippedTooShort.length > 0, true);
  assert.equal(
    audit.coverage.skippedTooShort.every((item: any) => item.label === 'student_id'),
    true,
  );
});

test('verifier calldata is inside the audited surface', () => {
  const rho = '9123456789012345678901234567890123456789012345678901234567890123';
  const audit = privateWitnessLeakageCheck({ verifierCalldata: '0x' + rho }, { rho });

  assert.equal(audit.passed, false);
  assert.equal(audit.exposedValues.length > 0, true);
});
