const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const RESULTS_DIR = path.join(__dirname, '..', '..', 'experiments', 'results');

const GENUINE_FIXTURE = path.join(RESULTS_DIR, 'quantitative', 'proofs_n1.json');

const DIVERTED_FIXTURE = path.join(RESULTS_DIR, 'insider', 'diverted_proof_n1.json');

function decodePublicInputs(calldata) {
  return {
    root: '0x' + calldata.slice(2, 66),
    nullifier: '0x' + calldata.slice(66, 130),
    amount: ethers.BigNumber.from('0x' + calldata.slice(130, 194)),
    recipient: ethers.utils.getAddress('0x' + calldata.slice(218, 258)),
  };
}

function loadRecord(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  const record = Array.isArray(records) ? records[0] : records;

  return { ...record, ...decodePublicInputs(record.calldata) };
}

async function expectRevert(promise, expectedReason) {
  let reason = null;

  try {
    await promise;
  } catch (error) {
    reason = String(error.message || '');
  }

  assert.ok(reason !== null, `Expected a revert with "${expectedReason}" but the call SUCCEEDED`);
  assert.ok(reason.includes(expectedReason), `Must revert because of "${expectedReason}", got: ${reason}`);
}

describe('ShieldedPool - university insider with a REAL proof (Mode B)', function () {
  let school;
  let student;
  let verifier;
  let pool;
  let genuine;
  let diverted;

  beforeEach(async function () {
    genuine = loadRecord(GENUINE_FIXTURE);
    diverted = loadRecord(DIVERTED_FIXTURE);

    if (!genuine || !diverted) {
      this.skip();
    }

    [school, student] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('Halo2Verifier', school);
    verifier = await Verifier.deploy();
    await verifier.deployed();

    const Pool = await ethers.getContractFactory('ShieldedPool', school);
    pool = await Pool.deploy(verifier.address, 0, { value: ethers.utils.parseEther('1') });
    await pool.deployed();

    await (await pool.updateRoot(genuine.root, [diverted.commitment])).wait();
  });

  it('the diverted proof is for the SAME note: same root, nullifier and amount, recipient = university wallet', async function () {
    assert.strictEqual(genuine.recipient, student.address);
    assert.strictEqual(diverted.recipient, school.address);
    assert.strictEqual(diverted.root, genuine.root);
    assert.strictEqual(diverted.nullifier, genuine.nullifier);
    assert.ok(diverted.amount.eq(genuine.amount));

    await ethers.provider.call({ to: verifier.address, data: diverted.calldata, gasLimit: 3000000 });
  });

  it('INSIDER: the university records and settles the diverted proof and the money goes to its own wallet', async function () {
    const poolBefore = await ethers.provider.getBalance(pool.address);

    await (
      await pool.verifyAndRecord(
        diverted.calldata,
        diverted.root,
        diverted.nullifier,
        school.address,
        diverted.amount,
        { gasLimit: 3000000 },
      )
    ).wait();

    const claim = await pool.claims(diverted.nullifier);
    assert.strictEqual(claim.recipient, school.address);

    await (await pool.settle(diverted.nullifier, { gasLimit: 3000000 })).wait();

    const poolAfter = await ethers.provider.getBalance(pool.address);
    assert.ok(poolBefore.sub(poolAfter).eq(diverted.amount));

    const [withdrawal] = await pool.queryFilter(pool.filters.Withdraw());
    assert.strictEqual(withdrawal.args.recipient, school.address);
  });

  it('INSIDER: afterwards the student cannot withdraw the scholarship with the genuine proof', async function () {
    await (
      await pool.verifyAndRecord(
        diverted.calldata,
        diverted.root,
        diverted.nullifier,
        school.address,
        diverted.amount,
        { gasLimit: 3000000 },
      )
    ).wait();
    await (await pool.settle(diverted.nullifier, { gasLimit: 3000000 })).wait();

    await expectRevert(
      pool.verifyAndRecord(genuine.calldata, genuine.root, genuine.nullifier, student.address, genuine.amount, {
        gasLimit: 3000000,
      }),
      'claim already recorded',
    );
  });

  it('the same note cannot be paid twice: a second settle is rejected', async function () {
    await (
      await pool.verifyAndRecord(
        diverted.calldata,
        diverted.root,
        diverted.nullifier,
        school.address,
        diverted.amount,
        { gasLimit: 3000000 },
      )
    ).wait();
    await (await pool.settle(diverted.nullifier, { gasLimit: 3000000 })).wait();

    await expectRevert(pool.settle(diverted.nullifier, { gasLimit: 3000000 }), 'nullifier already used');
  });

  it('payouts never exceed the published commitments (1 note -> at most 1 payout)', async function () {
    await (
      await pool.verifyAndRecord(
        diverted.calldata,
        diverted.root,
        diverted.nullifier,
        school.address,
        diverted.amount,
        { gasLimit: 3000000 },
      )
    ).wait();
    await (await pool.settle(diverted.nullifier, { gasLimit: 3000000 })).wait();

    await expectRevert(
      pool.verifyAndRecord(genuine.calldata, genuine.root, genuine.nullifier, student.address, genuine.amount, {
        gasLimit: 3000000,
      }),
      'claim already recorded',
    );

    const published = await pool.queryFilter(pool.filters.CommitmentsPublished());
    const payouts = await pool.queryFilter(pool.filters.Withdraw());

    assert.strictEqual(published[0].args.commitments.length, 1);
    assert.strictEqual(payouts.length, 1);
  });
});
