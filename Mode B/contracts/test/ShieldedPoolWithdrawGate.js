const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const PROOF_FIXTURE =
  process.env.ONC_PROOF_FIXTURE ||
  path.join(__dirname, '..', '..', 'experiments', 'results', 'quantitative', 'proofs_n1.json');

function publicInputsFrom(calldata) {
  const body = calldata.replace(/^0x/, '');

  return {
    root: '0x' + body.slice(0, 64),
    nullifier: '0x' + body.slice(64, 128),
    amount: BigInt('0x' + body.slice(128, 192)),
  };
}

function bumpWord(word) {
  return '0x' + (BigInt(word) + 1n).toString(16).padStart(64, '0');
}

async function expectRevert(action, message) {
  try {
    await action();
    assert.fail(`The transaction MUST revert with "${message}" but it succeeded`);
  } catch (error) {
    assert.match(
      String(error.message),
      new RegExp(message),
      `Reverted for the wrong reason. Expected "${message}", got: ${error.message}`,
    );
  }
}

describe('ShieldedPool.withdraw - the require checks that bind arguments to the proof', function () {
  let pool;
  let university;
  let student;
  let calldata;
  let pub;

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
    pub = publicInputsFrom(calldata);

    [university, student] = await ethers.getSigners();

    const verifier = await (await ethers.getContractFactory('Halo2Verifier', university)).deploy();
    await verifier.deployed();

    pool = await (
      await ethers.getContractFactory('ShieldedPool', university)
    ).deploy(verifier.address, 0, {
      value: ethers.utils.parseEther('10'),
    });
    await pool.deployed();

    await (await pool.updateRoot(pub.root, [])).wait();
  });

  it('accepts when the arguments match the public inputs in the proof', async function () {
    const before = await ethers.provider.getBalance(student.address);

    await (await pool.withdraw(calldata, pub.root, pub.nullifier, student.address, pub.amount)).wait();

    const after = await ethers.provider.getBalance(student.address);

    assert.strictEqual(
      after.sub(before).toString(),
      pub.amount.toString(),
      'the student must receive exactly the amount bound in the proof',
    );
  });

  it('reverts when ROOT differs from the public input in the proof', async function () {
    await expectRevert(
      () => pool.withdraw(calldata, bumpWord(pub.root), pub.nullifier, student.address, pub.amount),
      'root differs from proof',
    );
  });

  it('reverts when NULLIFIER differs from the public input in the proof', async function () {
    await expectRevert(
      () => pool.withdraw(calldata, pub.root, bumpWord(pub.nullifier), student.address, pub.amount),
      'nullifier differs from proof',
    );
  });

  it('reverts when AMOUNT differs from the public input in the proof', async function () {
    await expectRevert(
      () => pool.withdraw(calldata, pub.root, pub.nullifier, student.address, pub.amount + 1n),
      'amount differs from proof',
    );
  });

  it('reverts when RECIPIENT differs from the wallet in the proof (A25 - proof copied to another wallet)', async function () {
    await expectRevert(
      () => pool.withdraw(calldata, pub.root, pub.nullifier, university.address, pub.amount),
      'recipient differs from proof',
    );
  });

  it('reverts when the root was not approved by the university (validRoot)', async function () {
    const otherVerifier = await (await ethers.getContractFactory('Halo2Verifier', university)).deploy();
    await otherVerifier.deployed();

    const freshPool = await (
      await ethers.getContractFactory('ShieldedPool', university)
    ).deploy(otherVerifier.address, 0, {
      value: ethers.utils.parseEther('10'),
    });
    await freshPool.deployed();

    await expectRevert(
      () => freshPool.withdraw(calldata, pub.root, pub.nullifier, student.address, pub.amount),
      'root not in history',
    );
  });
});
