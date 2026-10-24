const assert = require('assert');
const path = require('path');

const { ethers } = require('hardhat');

const PUBLISHED = require(
  path.resolve(
    __dirname,
    '..',
    '..',
    'experiments',
    'results',
    'quantitative',
    'report_run',
    'proofs_offchain_n1.json',
  ),
)[0];

const N1_COMMITMENT = '0x1dfb2717b633eb1b2caa61157a18874d3bea4d667a196175ed316796dd72f9c9';

async function assertReverted(action, expectedMessage) {
  try {
    await action();
    assert.fail('Expected transaction to revert');
  } catch (error) {
    assert.match(String(error.message), new RegExp(expectedMessage));
  }
}

describe('ShieldedPool - university insider (Mode A trusts the university)', function () {
  let university;
  let outsider;
  let pool;

  const amount = ethers.BigNumber.from(PUBLISHED.amountWei);
  const fabricated = [
    'note that was never issued #1',
    'note that was never issued #2',
    'note that was never issued #3',
  ].map((text) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(text)));

  async function withdrawEvents() {
    return pool.queryFilter(pool.filters.Withdraw());
  }

  beforeEach(async function () {
    [university, outsider] = await ethers.getSigners();

    const Pool = await ethers.getContractFactory('ShieldedPool', university);
    pool = await Pool.deploy(0, { value: amount.mul(10) });
    await pool.deployed();

    await pool.updateRoot(PUBLISHED.root, [N1_COMMITMENT]);
  });

  it('the published n = 1 pool commits to exactly one note', async function () {
    const published = await pool.queryFilter(pool.filters.CommitmentsPublished());

    assert.strictEqual(published.length, 1);
    assert.deepStrictEqual(published[0].args.commitments, [N1_COMMITMENT]);
    assert.strictEqual(await pool.validRoot(PUBLISHED.root), true);
  });

  it('pays the genuine withdrawal of that note (control)', async function () {
    const before = await ethers.provider.getBalance(PUBLISHED.address);

    await pool.withdrawOffChain(PUBLISHED.root, PUBLISHED.nullifier, PUBLISHED.address, amount);

    const after = await ethers.provider.getBalance(PUBLISHED.address);
    assert.strictEqual(after.sub(before).toString(), amount.toString());
  });

  it('INSIDER: pays nullifiers that belong to no issued note, to the university own wallet', async function () {
    await pool.withdrawOffChain(PUBLISHED.root, PUBLISHED.nullifier, PUBLISHED.address, amount);

    const poolBefore = await ethers.provider.getBalance(pool.address);

    for (const nullifier of fabricated) {
      await pool.withdrawOffChain(PUBLISHED.root, nullifier, university.address, amount);
    }

    const poolAfter = await ethers.provider.getBalance(pool.address);
    const events = await withdrawEvents();

    assert.strictEqual(poolBefore.sub(poolAfter).toString(), amount.mul(fabricated.length).toString());
    assert.strictEqual(events.length, 1 + fabricated.length);
    assert.ok(events.length > 1, 'more payouts than issued notes');
    assert.deepStrictEqual(
      events.slice(1).map((e) => e.args.recipient),
      fabricated.map(() => university.address),
    );
  });

  it('INSIDER: the chain cannot tell a fabricated payout from a genuine one', async function () {
    await pool.withdrawOffChain(PUBLISHED.root, PUBLISHED.nullifier, PUBLISHED.address, amount);
    await pool.withdrawOffChain(PUBLISHED.root, fabricated[0], university.address, amount);

    const [genuine, fake] = await withdrawEvents();

    assert.deepStrictEqual(Object.keys(genuine.args), Object.keys(fake.args));
    assert.strictEqual(genuine.args.root, fake.args.root);
    assert.strictEqual(genuine.args.amount.toString(), fake.args.amount.toString());
    assert.strictEqual(genuine.data.length, fake.data.length);
  });

  it('INSIDER: an amount that matches no note is paid as well when the pool has no denomination', async function () {
    await pool.withdrawOffChain(PUBLISHED.root, fabricated[0], university.address, amount.mul(3));

    const [event] = await withdrawEvents();
    assert.strictEqual(event.args.amount.toString(), amount.mul(3).toString());
  });

  it('the only on-chain limits: approved root, unused nullifier, pool balance, and the university as sender', async function () {
    await pool.withdrawOffChain(PUBLISHED.root, fabricated[0], university.address, amount);

    await assertReverted(
      () => pool.withdrawOffChain(PUBLISHED.root, fabricated[0], university.address, amount),
      'nullifier already used',
    );
    await assertReverted(
      () => pool.withdrawOffChain(ethers.utils.hexZeroPad('0xabcd', 32), fabricated[1], university.address, amount),
      'root not in history',
    );
    await assertReverted(
      () => pool.withdrawOffChain(PUBLISHED.root, fabricated[1], university.address, amount.mul(1000)),
      'insufficient pool',
    );
    await assertReverted(
      () => pool.connect(outsider).withdrawOffChain(PUBLISHED.root, fabricated[2], outsider.address, amount),
      'not school',
    );
  });
});
