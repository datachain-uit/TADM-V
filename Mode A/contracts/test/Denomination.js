const assert = require('assert');

const { ethers } = require('hardhat');

async function assertReverted(action, expectedMessage) {
  try {
    await action();
    assert.fail('Expected transaction to revert');
  } catch (error) {
    assert.match(String(error.message), new RegExp(expectedMessage));
  }
}

describe('ShieldedPool - V1(b) denomination', function () {
  let university;
  let student;
  let studentTwo;

  const DENOMINATION = ethers.utils.parseEther('0.1');

  async function deployPool(denomination) {
    const Pool = await ethers.getContractFactory('ShieldedPool', university);

    const pool = await Pool.deploy(denomination, {
      value: ethers.utils.parseEther('1'),
    });

    await pool.deployed();

    return pool;
  }

  function word(hex) {
    return ethers.utils.hexZeroPad(hex, 32);
  }

  beforeEach(async function () {
    [university, student, studentTwo] = await ethers.getSigners();
  });

  it('stores the denomination at deploy time and exposes it on-chain', async function () {
    const pool = await deployPool(DENOMINATION);

    assert.strictEqual((await pool.denomination()).toString(), DENOMINATION.toString());
  });

  it('REJECTS a withdrawal with the wrong denomination', async function () {
    const pool = await deployPool(DENOMINATION);
    const root = word('0xabcd');

    await pool.updateRoot(root, []);

    await assertReverted(
      () =>
        pool.withdrawOffChain(
          root,
          word('0x01'),
          student.address,

          DENOMINATION.add(1),
        ),
      'wrong denomination',
    );
  });

  it('ACCEPTS a withdrawal with the right denomination', async function () {
    const pool = await deployPool(DENOMINATION);
    const root = word('0xabcd');

    await pool.updateRoot(root, []);

    const before = await ethers.provider.getBalance(student.address);

    await pool.withdrawOffChain(root, word('0x02'), student.address, DENOMINATION);

    const after = await ethers.provider.getBalance(student.address);

    assert.strictEqual(after.sub(before).toString(), DENOMINATION.toString());
  });

  it('every withdrawal pays the same amount, so payouts cannot be told apart by amount', async function () {
    const pool = await deployPool(DENOMINATION);
    const root = word('0xabcd');

    await pool.updateRoot(root, []);

    const withdrawFilter = await pool.filters.Withdraw();

    await pool.withdrawOffChain(root, word('0x11'), student.address, DENOMINATION);

    await pool.withdrawOffChain(root, word('0x12'), studentTwo.address, DENOMINATION);

    const events = await pool.queryFilter(withdrawFilter);

    assert.strictEqual(events.length, 2);

    assert.strictEqual(events[0].args.amount.toString(), events[1].args.amount.toString());

    assert.notStrictEqual(events[0].args.recipient, events[1].args.recipient);
  });

  it('denomination = 0 does NOT enforce an amount - keeps the C-13 control scenario possible', async function () {
    const pool = await deployPool(0);
    const root = word('0xabcd');

    await pool.updateRoot(root, []);

    await pool.withdrawOffChain(root, word('0x21'), student.address, ethers.utils.parseEther('0.1'));

    await pool.withdrawOffChain(root, word('0x22'), studentTwo.address, ethers.utils.parseEther('0.2'));

    assert.strictEqual((await pool.denomination()).toString(), '0');
  });
});
