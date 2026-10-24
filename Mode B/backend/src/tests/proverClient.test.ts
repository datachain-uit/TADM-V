import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { proverBinary, runProver } from '../clients/prover/halo2ProverClient';

test('prover client resolves the binary and computes a real commitment', () => {
  assert.equal(fs.existsSync(proverBinary()), true);

  const output = runProver('commitment', {
    student_id: 1,
    amount: '1000',
    rho: '123',
  });

  assert.equal(output.commitment, '0x1033045e6936e742c6bc862619ad3a1a00b2c0ef705b7657db12088969b01c02');
});
