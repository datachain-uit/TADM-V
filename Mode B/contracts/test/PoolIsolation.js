const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const RESULTS_DIR = path.join(__dirname, '..', '..', 'experiments', 'results', 'quantitative');

const FIXTURE_A = process.env.ONC_POOL_A_FIXTURE || path.join(RESULTS_DIR, 'proofs_n1.json');

const FIXTURE_B = process.env.ONC_POOL_B_FIXTURE || path.join(RESULTS_DIR, 'proofs_n10.json');

function decodePublicInputs(calldata) {
  return {
    root: '0x' + calldata.slice(2, 66),
    nullifier: '0x' + calldata.slice(66, 130),
    amount: ethers.BigNumber.from('0x' + calldata.slice(130, 194)),

    recipient: ethers.utils.getAddress('0x' + calldata.slice(218, 258)),
  };
}

function loadProof(fixture) {
  if (!fs.existsSync(fixture)) {
    return null;
  }

  const records = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const record = Array.isArray(records) ? records[0] : records;

  if (!record || typeof record.calldata !== 'string') {
    return null;
  }

  return {
    calldata: record.calldata,
    ...decodePublicInputs(record.calldata),
  };
}

describe('Pools are independent of each other', function () {
  let verifier;
  let poolA;
  let poolB;
  let school;
  let studentA;
  let studentB;
  let proofA;
  let proofB;

  before(async function () {
    proofA = loadProof(FIXTURE_A);
    proofB = loadProof(FIXTURE_B);

    if (!proofA || !proofB) {
      this.skip();
    }

    if (proofA.root === proofB.root) {
      this.skip();
    }

    [school, studentA, studentB] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('Halo2Verifier', school);
    verifier = await Verifier.deploy();
    await verifier.deployed();

    const Pool = await ethers.getContractFactory('ShieldedPool', school);

    poolA = await Pool.deploy(verifier.address, 0, { value: ethers.utils.parseEther('1') });
    await poolA.deployed();

    poolB = await Pool.deploy(verifier.address, 0, { value: ethers.utils.parseEther('1') });
    await poolB.deployed();

    await (await poolA.updateRoot(proofA.root, [])).wait();
    await (await poolB.updateRoot(proofB.root, [])).wait();
  });

  it('1. two pools share ONE verifier', async function () {
    assert.strictEqual(await poolA.verifier(), verifier.address, 'poolA must point to the shared verifier');

    assert.strictEqual(await poolB.verifier(), verifier.address, 'poolB must point to the shared verifier');
  });

  it('2. each pool only knows its own root', async function () {
    assert.strictEqual(await poolA.validRoot(proofA.root), true, 'poolA must know the root of A');

    assert.strictEqual(await poolA.validRoot(proofB.root), false, 'poolA must NOT know the root of B');

    assert.strictEqual(await poolB.validRoot(proofB.root), true, 'poolB must know the root of B');

    assert.strictEqual(await poolB.validRoot(proofA.root), false, 'poolB must NOT know the root of A');
  });

  it('3. a VALID proof of pool A sent to pool B -> REVERT', async function () {
    let reverted = false;
    let reason = '';

    try {
      await poolB.withdraw(proofA.calldata, proofA.root, proofA.nullifier, proofA.recipient, proofA.amount, {
        gasLimit: 3000000,
      });
    } catch (error) {
      reverted = true;
      reason = String(error.message || '');
    }

    assert.ok(
      reverted,
      'CRITICAL: pool B accepted a proof of pool A, so one program could be drained by students of another',
    );

    assert.ok(reason.includes('root not in history'), 'must revert because of `root not in history`, got: ' + reason);
  });

  it('4. after A withdraws, the nullifier of A does not block pool B', async function () {
    await (
      await poolA.withdraw(proofA.calldata, proofA.root, proofA.nullifier, proofA.recipient, proofA.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    assert.strictEqual(await poolA.usedNullifier(proofA.nullifier), true, 'poolA must record the used nullifier');

    assert.strictEqual(await poolB.usedNullifier(proofA.nullifier), false, 'poolB must NOT see the nullifier of poolA');

    await (
      await poolB.withdraw(proofB.calldata, proofB.root, proofB.nullifier, proofB.recipient, proofB.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    assert.strictEqual(
      await poolB.usedNullifier(proofB.nullifier),
      true,
      'poolB must still pay out after poolA has paid',
    );
  });

  it('5. withdrawing again from pool A is still blocked (the nullifier still works)', async function () {
    let reverted = false;
    let reason = '';

    try {
      await poolA.withdraw(proofA.calldata, proofA.root, proofA.nullifier, proofA.recipient, proofA.amount, {
        gasLimit: 3000000,
      });
    } catch (error) {
      reverted = true;
      reason = String(error.message || '');
    }

    assert.ok(reverted, 'a repeated withdrawal must be blocked');

    assert.ok(
      reason.includes('nullifier already used'),
      'must revert because of `nullifier already used`, got: ' + reason,
    );
  });
});
