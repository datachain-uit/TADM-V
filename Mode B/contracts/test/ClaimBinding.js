const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const RESULTS_DIR = path.join(__dirname, '..', '..', 'experiments', 'results', 'quantitative');

const FIXTURE = process.env.ONC_PROOF_FIXTURE || path.join(RESULTS_DIR, 'proofs_n1.json');

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

async function expectRevert(promise, expectedReason) {
  let reverted = false;
  let reason = '';

  try {
    await promise;
  } catch (error) {
    reverted = true;
    reason = String(error.message || '');
  }

  assert.ok(reverted, `Expected a revert with "${expectedReason}" but the call SUCCEEDED`);

  assert.ok(reason.includes(expectedReason), `Must revert because of "${expectedReason}", got: ${reason}`);
}

describe('Claim binding - verification separated from payment', function () {
  let verifier;
  let pool;
  let school;
  let student;
  let attacker;
  let proof;

  beforeEach(async function () {
    proof = loadProof(FIXTURE);

    if (!proof) {
      this.skip();
    }

    [school, student, attacker] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('Halo2Verifier', school);
    verifier = await Verifier.deploy();
    await verifier.deployed();

    const Pool = await ethers.getContractFactory('ShieldedPool', school);
    pool = await Pool.deploy(verifier.address, 0, { value: ethers.utils.parseEther('1') });
    await pool.deployed();

    await (await pool.updateRoot(proof.root, [])).wait();
  });

  it('1. verifyAndRecord -> settle: the RIGHT person receives the RIGHT amount', async function () {
    await (
      await pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    const claim = await pool.claims(proof.nullifier);

    assert.strictEqual(claim.verified, true, 'the claim must be recorded');
    assert.strictEqual(claim.recipient, student.address, 'the claim must store the RIGHT recipient');
    assert.ok(claim.amount.eq(proof.amount), 'the claim must store the RIGHT amount');
    assert.strictEqual(claim.root, proof.root, 'the claim must store the RIGHT root');

    const before = await ethers.provider.getBalance(student.address);

    await (await pool.settle(proof.nullifier, { gasLimit: 3000000 })).wait();

    const after = await ethers.provider.getBalance(student.address);

    assert.ok(after.sub(before).eq(proof.amount), 'the student must receive EXACTLY the proven amount');

    assert.strictEqual(await pool.usedNullifier(proof.nullifier), true, 'the nullifier must be marked as used');
  });

  it('2. settle BEFORE verifyAndRecord -> revert', async function () {
    await expectRevert(pool.settle(proof.nullifier, { gasLimit: 3000000 }), 'claim not verified');
  });

  it('3. verifyAndRecord TWICE with the same nullifier -> revert (the recipient cannot be overwritten)', async function () {
    await (
      await pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    await expectRevert(
      pool
        .connect(attacker)
        .verifyAndRecord(proof.calldata, proof.root, proof.nullifier, attacker.address, proof.amount, {
          gasLimit: 3000000,
        }),
      'not school',
    );

    await expectRevert(
      pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, attacker.address, proof.amount, {
        gasLimit: 3000000,
      }),
      'recipient differs from proof',
    );

    await expectRevert(
      pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount, {
        gasLimit: 3000000,
      }),
      'claim already recorded',
    );

    const claim = await pool.claims(proof.nullifier);
    assert.strictEqual(claim.recipient, student.address, 'CRITICAL: the recipient stored in the claim was overwritten');
  });

  it('4. settle TWICE -> revert', async function () {
    await (
      await pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    await (await pool.settle(proof.nullifier, { gasLimit: 3000000 })).wait();

    await expectRevert(pool.settle(proof.nullifier, { gasLimit: 3000000 }), 'nullifier already used');
  });

  it('5. amount differs from the public input in the proof -> revert', async function () {
    await expectRevert(
      pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount.add(1), {
        gasLimit: 3000000,
      }),
      'amount differs from proof',
    );
  });

  it('6. settle by an account that is NOT the school -> revert', async function () {
    await (
      await pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    await expectRevert(pool.connect(attacker).settle(proof.nullifier, { gasLimit: 3000000 }), 'not school');
  });

  it('7. `settle` takes only the nullifier - there is no argument that could be passed wrongly', function () {
    const fragment = pool.interface.getFunction('settle');

    assert.strictEqual(fragment.inputs.length, 1, 'settle must take EXACTLY ONE argument');

    assert.strictEqual(fragment.inputs[0].type, 'bytes32', 'the only argument must be the nullifier (bytes32)');
  });

  it('8. A25 - an attacker submitting BEFORE the university is blocked; the money still reaches the student', async function () {
    assert.strictEqual(
      proof.recipient,
      student.address,
      'the fixture must be bound to the student wallet - regenerate the proof with this recipient',
    );

    await expectRevert(
      pool
        .connect(attacker)
        .verifyAndRecord(proof.calldata, proof.root, proof.nullifier, attacker.address, proof.amount, {
          gasLimit: 3000000,
        }),
      'not school',
    );

    const emptyClaim = await pool.claims(proof.nullifier);
    assert.strictEqual(emptyClaim.verified, false, 'CRITICAL: the attacker managed to record a claim');

    await (
      await pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, student.address, proof.amount, {
        gasLimit: 3000000,
      })
    ).wait();

    const claim = await pool.claims(proof.nullifier);
    assert.strictEqual(claim.recipient, student.address);

    const before = await ethers.provider.getBalance(student.address);
    await (await pool.settle(proof.nullifier, { gasLimit: 3000000 })).wait();
    const after = await ethers.provider.getBalance(student.address);
    assert.ok(after.sub(before).eq(proof.amount), 'the money must reach the right student');
  });

  it('9. A25 - a valid proof with a recipient that differs from the proof -> revert, even for the university', async function () {
    await expectRevert(
      pool.verifyAndRecord(proof.calldata, proof.root, proof.nullifier, attacker.address, proof.amount, {
        gasLimit: 3000000,
      }),
      'recipient differs from proof',
    );

    const emptyClaim = await pool.claims(proof.nullifier);
    assert.strictEqual(emptyClaim.verified, false, 'no claim may be recorded');
  });
});
