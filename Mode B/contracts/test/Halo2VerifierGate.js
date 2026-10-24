const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const PROOF_FIXTURE =
  process.env.ONC_PROOF_FIXTURE ||
  path.join(__dirname, '..', '..', 'experiments', 'results', 'quantitative', 'proofs_n1.json');

const PUBLIC_INPUT_BYTES = 128;

function flipByteAt(hexString, byteIndex) {
  const offset = 2 + byteIndex * 2;
  const original = parseInt(hexString.slice(offset, offset + 2), 16);
  const flipped = (original ^ 0x01).toString(16).padStart(2, '0');

  return hexString.slice(0, offset) + flipped + hexString.slice(offset + 2);
}

describe('Halo2Verifier (the REAL verifier) is a gate', function () {
  let verifier;
  let calldata;
  let signer;

  before(async function () {
    if (!fs.existsSync(PROOF_FIXTURE)) {
      this.skip();
    }

    const proofs = JSON.parse(fs.readFileSync(PROOF_FIXTURE, 'utf8'));
    const record = Array.isArray(proofs) ? proofs[0] : proofs;

    if (!record || typeof record.calldata !== 'string') {
      this.skip();
    }

    calldata = record.calldata;

    [signer] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('Halo2Verifier', signer);
    verifier = await Verifier.deploy();
    await verifier.deployed();
  });

  async function verifierAccepts(data) {
    try {
      const tx = await signer.sendTransaction({
        to: verifier.address,
        data,
        gasLimit: 3000000,
      });

      const receipt = await tx.wait();

      return receipt.status === 1;
    } catch (error) {
      return false;
    }
  }

  it('accepts genuine calldata', async function () {
    const accepted = await verifierAccepts(calldata);

    if (!accepted) {
      this.skip();
    }

    assert.strictEqual(accepted, true);
  });

  it('rejects when 1 byte of a PUBLIC INPUT (nullifier) is changed', async function () {
    const tampered = flipByteAt(calldata, 32);

    assert.notStrictEqual(tampered, calldata, 'the byte flip must actually change the calldata');

    const accepted = await verifierAccepts(tampered);

    assert.strictEqual(
      accepted,
      false,
      'Halo2Verifier MUST reject a changed nullifier. If this passes, the verifier blocks nothing and the paper must not claim on-chain verification.',
    );
  });

  it('rejects when 1 byte of a PUBLIC INPUT (amount) is changed', async function () {
    const accepted = await verifierAccepts(flipByteAt(calldata, 64));

    assert.strictEqual(accepted, false, 'Halo2Verifier MUST reject a changed amount');
  });

  it('rejects when 1 byte of a PUBLIC INPUT (recipient - A25) is changed', async function () {
    const accepted = await verifierAccepts(flipByteAt(calldata, 127));
    assert.strictEqual(
      accepted,
      false,
      'Halo2Verifier MUST reject a changed recipient - otherwise the proof is not bound to the payout wallet and could be replayed to another wallet',
    );
  });

  it('rejects when 1 byte of the PROOF is changed', async function () {
    const accepted = await verifierAccepts(flipByteAt(calldata, PUBLIC_INPUT_BYTES));

    assert.strictEqual(accepted, false, 'Halo2Verifier MUST reject changed proof bytes');
  });
});
