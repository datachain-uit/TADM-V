const assert = require("assert");
const { ethers } = require("hardhat");

async function expectRevert(action, message) {
  try {
    await action();
    assert.fail("Expected transaction to revert");
  } catch (error) {
    assert.match(String(error.message), new RegExp(message));
  }
}

function proofCalldata(root, nullifier, amount, recipient) {
  return ethers.utils.hexConcat([
    root,
    nullifier,
    ethers.utils.hexZeroPad(ethers.BigNumber.from(amount).toHexString(), 32),
    ethers.utils.hexZeroPad(recipient, 32), // A25 — word thu 4
    "0x1234",
  ]);
}

describe("ShieldedPool business flow", function () {
  let university;
  let sponsor;
  let student;
  let verifier;
  let pool;

  beforeEach(async function () {
    [university, sponsor, student] = await ethers.getSigners();
    const Verifier = await ethers.getContractFactory("MockHalo2Verifier", university);
    verifier = await Verifier.deploy();
    await verifier.deployed();

    const Pool = await ethers.getContractFactory("ShieldedPool", university);
    pool = await Pool.deploy(verifier.address, 0);
    await pool.deployed();
  });

  it("lets a sponsor fund the university pool", async function () {
    const amount = ethers.utils.parseEther("1");
    await sponsor.sendTransaction({ to: pool.address, value: amount });
    assert.strictEqual((await pool.getBalance()).toString(), amount.toString());
    assert.strictEqual((await pool.school()).toLowerCase(), university.address.toLowerCase());
  });

  it("restricts root publication and withdrawal approval to the university", async function () {
    const root = ethers.utils.hexZeroPad("0x11", 32);
    const nullifier = ethers.utils.hexZeroPad("0x22", 32);
    const amount = ethers.utils.parseEther("0.1");
    await sponsor.sendTransaction({ to: pool.address, value: amount });

    await expectRevert(() => pool.connect(sponsor).updateRoot(root, []), "not school");
    await pool.updateRoot(root, []);
    const calldata = proofCalldata(root, nullifier, amount, student.address);
    await expectRevert(
      () => pool.connect(student).withdraw(calldata, root, nullifier, student.address, amount),
      "not school",
    );
  });

  it("binds proof inputs, verifies, pays once, then rejects the same nullifier", async function () {
    const root = ethers.utils.hexZeroPad("0xabcd", 32);
    const nullifier = ethers.utils.hexZeroPad("0x99", 32);
    const amount = ethers.utils.parseEther("0.1");
    const calldata = proofCalldata(root, nullifier, amount, student.address);

    await sponsor.sendTransaction({ to: pool.address, value: amount.mul(2) });
    await pool.updateRoot(root, []);

    const before = await ethers.provider.getBalance(student.address);
    await pool.withdraw(calldata, root, nullifier, student.address, amount);
    const after = await ethers.provider.getBalance(student.address);
    assert.strictEqual(after.sub(before).toString(), amount.toString());
    assert.strictEqual(await pool.usedNullifier(nullifier), true);

    await expectRevert(
      async () => {
        const tx = await pool.withdraw(calldata, root, nullifier, student.address, amount, {
          gasLimit: 500000,
        });
        await tx.wait();
      },
      "nullifier already used",
    );

    const otherRoot = ethers.utils.hexZeroPad("0x1234", 32);
    await expectRevert(
      () => pool.withdraw(calldata, otherRoot, nullifier, student.address, amount),
      "root differs from proof",
    );
  });

  it("rejects a proof when the verifier reverts", async function () {
    const root = ethers.utils.hexZeroPad("0x33", 32);
    const nullifier = ethers.utils.hexZeroPad("0x44", 32);
    const amount = ethers.utils.parseEther("0.1");
    await sponsor.sendTransaction({ to: pool.address, value: amount });
    await pool.updateRoot(root, []);
    await verifier.setAcceptsProof(false);

    await expectRevert(
      () => pool.withdraw(proofCalldata(root, nullifier, amount, student.address), root, nullifier, student.address, amount),
      "invalid proof",
    );
    assert.strictEqual(await pool.usedNullifier(nullifier), false);
  });
});
