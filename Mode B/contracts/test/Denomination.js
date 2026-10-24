const assert = require('assert');

const { ethers } = require('hardhat');

function buildCalldata(root, nullifier, amount, recipient) {
  const w = (v) => ethers.utils.hexZeroPad(ethers.BigNumber.from(v).toHexString(), 32).replace(/^0x/, '');

  return '0x' + w(root) + w(nullifier) + w(amount) + w(recipient) + '00'.repeat(64);
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

describe('ShieldedPool - V1(b) denomination (on-chain)', function () {
  let university;
  let student;
  let studentTwo;
  let verifier;

  const DENOMINATION = ethers.utils.parseEther('0.1');

  const ROOT = ethers.utils.hexZeroPad('0xabcd', 32);

  async function deployPool(denomination) {
    const Pool = await ethers.getContractFactory('ShieldedPool', university);

    const pool = await Pool.deploy(verifier.address, denomination, {
      value: ethers.utils.parseEther('1'),
    });

    await pool.deployed();
    await (await pool.updateRoot(ROOT, [])).wait();

    return pool;
  }

  beforeEach(async function () {
    [university, student, studentTwo] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('MockHalo2Verifier', university);

    verifier = await Verifier.deploy();
    await verifier.deployed();
  });

  it('stores the denomination at deploy time and exposes it on-chain', async function () {
    const pool = await deployPool(DENOMINATION);

    assert.strictEqual((await pool.denomination()).toString(), DENOMINATION.toString());
  });

  it('REJECTS a withdrawal with the wrong denomination', async function () {
    const pool = await deployPool(DENOMINATION);

    const wrongAmount = DENOMINATION.add(1);

    await expectRevert(
      () =>
        pool.withdraw(
          buildCalldata(ROOT, 1, wrongAmount, student.address),
          ROOT,
          ethers.utils.hexZeroPad('0x01', 32),
          student.address,
          wrongAmount,
        ),
      'wrong denomination',
    );
  });

  it('ACCEPTS a withdrawal with the right denomination', async function () {
    const pool = await deployPool(DENOMINATION);

    const before = await ethers.provider.getBalance(student.address);

    await (
      await pool.withdraw(
        buildCalldata(ROOT, 2, DENOMINATION, student.address),
        ROOT,
        ethers.utils.hexZeroPad('0x02', 32),
        student.address,
        DENOMINATION,
      )
    ).wait();

    const after = await ethers.provider.getBalance(student.address);

    assert.strictEqual(after.sub(before).toString(), DENOMINATION.toString());
  });

  it('every withdrawal pays the same amount, so payouts cannot be told apart by amount', async function () {
    const pool = await deployPool(DENOMINATION);

    await (
      await pool.withdraw(
        buildCalldata(ROOT, 0x11, DENOMINATION, student.address),
        ROOT,
        ethers.utils.hexZeroPad('0x11', 32),
        student.address,
        DENOMINATION,
      )
    ).wait();

    await (
      await pool.withdraw(
        buildCalldata(ROOT, 0x12, DENOMINATION, studentTwo.address),
        ROOT,
        ethers.utils.hexZeroPad('0x12', 32),
        studentTwo.address,
        DENOMINATION,
      )
    ).wait();

    const events = await pool.queryFilter(pool.filters.Withdraw());

    assert.strictEqual(events.length, 2);

    assert.strictEqual(events[0].args.amount.toString(), events[1].args.amount.toString());

    assert.notStrictEqual(events[0].args.recipient, events[1].args.recipient);
  });

  it('denomination = 0 does NOT enforce an amount - keeps the C-13 control scenario possible', async function () {
    const pool = await deployPool(0);

    const firstAmount = ethers.utils.parseEther('0.1');
    const secondAmount = ethers.utils.parseEther('0.2');

    await (
      await pool.withdraw(
        buildCalldata(ROOT, 0x21, firstAmount, student.address),
        ROOT,
        ethers.utils.hexZeroPad('0x21', 32),
        student.address,
        firstAmount,
      )
    ).wait();

    await (
      await pool.withdraw(
        buildCalldata(ROOT, 0x22, secondAmount, studentTwo.address),
        ROOT,
        ethers.utils.hexZeroPad('0x22', 32),
        studentTwo.address,
        secondAmount,
      )
    ).wait();

    assert.strictEqual((await pool.denomination()).toString(), '0');
  });
});
