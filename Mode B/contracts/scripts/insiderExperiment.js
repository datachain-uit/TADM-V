const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const RESULTS_DIR = path.resolve(__dirname, '..', '..', 'experiments', 'results');

const GENUINE = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'quantitative', 'proofs_n1.json'), 'utf8'))[0];

const DIVERTED = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'insider', 'diverted_proof_n1.json'), 'utf8'));

const OUTPUT_FILE = path.join(RESULTS_DIR, 'insider', 'insider_onchain.csv');

const COLUMNS = [
  'step',
  'actor',
  'call',
  'proof_source',
  'recipient',
  'amount_wei',
  'outcome',
  'revert_reason',
  'gas_used',
  'pool_balance_after_wei',
  'tx_hash',
];

function decode(calldata) {
  return {
    calldata,
    root: '0x' + calldata.slice(2, 66),
    nullifier: '0x' + calldata.slice(66, 130),
    amount: ethers.BigNumber.from('0x' + calldata.slice(130, 194)),
    recipient: ethers.utils.getAddress('0x' + calldata.slice(218, 258)),
  };
}

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);

  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, "'")}"` : text;
}

function reasonOf(error) {
  const message = String(error?.message || error);
  const match = /reverted with reason string '([^']+)'/.exec(message);

  return match ? match[1] : message.split('\n')[0];
}

function flipByte(calldata, byteIndex) {
  const at = 2 + byteIndex * 2;
  const flipped = (parseInt(calldata.slice(at, at + 2), 16) ^ 0x01).toString(16).padStart(2, '0');

  return calldata.slice(0, at) + flipped + calldata.slice(at + 2);
}

async function main() {
  const [university, student] = await ethers.getSigners();
  const genuine = decode(GENUINE.calldata);
  const diverted = decode(DIVERTED.calldata);

  const Verifier = await ethers.getContractFactory('Halo2Verifier', university);
  const verifier = await Verifier.deploy();
  await verifier.deployed();

  const Pool = await ethers.getContractFactory('ShieldedPool', university);
  const pool = await Pool.deploy(verifier.address, 0, { value: ethers.utils.parseEther('1') });
  await pool.deployed();
  await (await pool.updateRoot(genuine.root, [DIVERTED.commitment])).wait();

  const rows = [];

  async function attempt(step, actor, call, proofSource, recipient, value, send) {
    const row = { step, actor, call, proof_source: proofSource, recipient, amount_wei: value.toString() };

    try {
      const receipt = await (await send()).wait();
      Object.assign(row, {
        outcome: call === 'settle' ? 'paid' : 'recorded',
        gas_used: receipt.gasUsed.toString(),
        tx_hash: receipt.transactionHash,
      });
    } catch (error) {
      Object.assign(row, { outcome: 'reverted', revert_reason: reasonOf(error) });
    }

    row.pool_balance_after_wei = (await ethers.provider.getBalance(pool.address)).toString();
    rows.push(row);
  }

  const gas = { gasLimit: 3000000 };
  const fabricatedNullifier = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('fabricated #1'));
  const tampered = flipByte(genuine.calldata, 200);

  await attempt(
    1,
    'university insider',
    'verifyAndRecord',
    'published proof, fabricated nullifier argument',
    university.address,
    genuine.amount,
    () =>
      pool.verifyAndRecord(
        genuine.calldata,
        genuine.root,
        fabricatedNullifier,
        university.address,
        genuine.amount,
        gas,
      ),
  );
  await attempt(
    2,
    'university insider',
    'verifyAndRecord',
    'published proof, recipient argument changed',
    university.address,
    genuine.amount,
    () =>
      pool.verifyAndRecord(genuine.calldata, genuine.root, genuine.nullifier, university.address, genuine.amount, gas),
  );
  await attempt(
    3,
    'university insider',
    'verifyAndRecord',
    'published proof with one proof byte changed',
    student.address,
    genuine.amount,
    () => pool.verifyAndRecord(tampered, genuine.root, genuine.nullifier, student.address, genuine.amount, gas),
  );
  await attempt(
    4,
    'university insider',
    'verifyAndRecord',
    'NEW real proof of the same note, university wallet as recipient',
    university.address,
    diverted.amount,
    () =>
      pool.verifyAndRecord(
        diverted.calldata,
        diverted.root,
        diverted.nullifier,
        university.address,
        diverted.amount,
        gas,
      ),
  );
  await attempt(
    5,
    'university insider',
    'settle',
    'claim recorded in step 4',
    university.address,
    diverted.amount,
    () => pool.settle(diverted.nullifier, gas),
  );
  await attempt(6, 'student (genuine)', 'verifyAndRecord', 'published proof', student.address, genuine.amount, () =>
    pool.verifyAndRecord(genuine.calldata, genuine.root, genuine.nullifier, student.address, genuine.amount, gas),
  );
  await attempt(7, 'university insider', 'settle', 'same note again', university.address, diverted.amount, () =>
    pool.settle(diverted.nullifier, gas),
  );

  const published = await pool.queryFilter(pool.filters.CommitmentsPublished());
  const payouts = await pool.queryFilter(pool.filters.Withdraw());

  rows.push({
    step: 'summary',
    proof_source: `commitments published: ${published[0].args.commitments.length}`,
    outcome: `payouts: ${payouts.length} (to ${payouts.map((p) => p.args.recipient).join(' ')})`,
    pool_balance_after_wei: (await ethers.provider.getBalance(pool.address)).toString(),
  });

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => cell(row[c])).join(','))].join('\n') + '\n',
    'utf8',
  );

  console.log(
    JSON.stringify(
      { output: OUTPUT_FILE, commitmentsPublished: published[0].args.commitments.length, payouts: payouts.length },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
