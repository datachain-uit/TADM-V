const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const RESULTS_DIR = path.resolve(__dirname, '..', '..', 'experiments', 'results');

const PUBLISHED = require(path.join(RESULTS_DIR, 'quantitative', 'report_run', 'proofs_offchain_n1.json'))[0];

const N1_COMMITMENT = '0x1dfb2717b633eb1b2caa61157a18874d3bea4d667a196175ed316796dd72f9c9';

const OUTPUT_FILE = path.join(RESULTS_DIR, 'insider', 'insider_offchain.csv');

const COLUMNS = [
  'step',
  'actor',
  'call',
  'nullifier_source',
  'recipient',
  'amount_wei',
  'outcome',
  'revert_reason',
  'gas_used',
  'pool_balance_after_wei',
  'tx_hash',
];

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);

  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, "'")}"` : text;
}

function reasonOf(error) {
  const message = String(error?.message || error);
  const match = /reverted with reason string '([^']+)'/.exec(message);

  return match ? match[1] : message.split('\n')[0];
}

async function main() {
  const [university, outsider] = await ethers.getSigners();
  const amount = ethers.BigNumber.from(PUBLISHED.amountWei);
  const fabricated = (label) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));

  const Pool = await ethers.getContractFactory('ShieldedPool', university);
  const pool = await Pool.deploy(0, { value: amount.mul(10) });
  await pool.deployed();
  await (await pool.updateRoot(PUBLISHED.root, [N1_COMMITMENT])).wait();

  const rows = [];

  async function attempt(step, actor, signer, nullifierSource, root, nullifier, recipient, value) {
    const row = {
      step,
      actor,
      call: 'withdrawOffChain',
      nullifier_source: nullifierSource,
      recipient,
      amount_wei: value.toString(),
    };

    try {
      const receipt = await (await pool.connect(signer).withdrawOffChain(root, nullifier, recipient, value)).wait();
      Object.assign(row, { outcome: 'paid', gas_used: receipt.gasUsed.toString(), tx_hash: receipt.transactionHash });
    } catch (error) {
      Object.assign(row, { outcome: 'reverted', revert_reason: reasonOf(error) });
    }

    row.pool_balance_after_wei = (await ethers.provider.getBalance(pool.address)).toString();
    rows.push(row);
  }

  await attempt(
    1,
    'student (genuine)',
    university,
    'published proof',
    PUBLISHED.root,
    PUBLISHED.nullifier,
    PUBLISHED.address,
    amount,
  );
  await attempt(
    2,
    'university insider',
    university,
    'fabricated #1',
    PUBLISHED.root,
    fabricated('fabricated #1'),
    university.address,
    amount,
  );
  await attempt(
    3,
    'university insider',
    university,
    'fabricated #2',
    PUBLISHED.root,
    fabricated('fabricated #2'),
    university.address,
    amount,
  );
  await attempt(
    4,
    'university insider',
    university,
    'fabricated #3',
    PUBLISHED.root,
    fabricated('fabricated #3'),
    university.address,
    amount,
  );
  await attempt(
    5,
    'university insider',
    university,
    'fabricated #4',
    PUBLISHED.root,
    fabricated('fabricated #4'),
    university.address,
    amount.mul(3),
  );
  await attempt(
    6,
    'university insider',
    university,
    'fabricated #1 again',
    PUBLISHED.root,
    fabricated('fabricated #1'),
    university.address,
    amount,
  );
  await attempt(
    7,
    'university insider',
    university,
    'fabricated #5',
    ethers.utils.hexZeroPad('0xabcd', 32),
    fabricated('fabricated #5'),
    university.address,
    amount,
  );
  await attempt(
    8,
    'university insider',
    university,
    'fabricated #6',
    PUBLISHED.root,
    fabricated('fabricated #6'),
    university.address,
    amount.mul(1000),
  );
  await attempt(
    9,
    'outsider',
    outsider,
    'fabricated #7',
    PUBLISHED.root,
    fabricated('fabricated #7'),
    outsider.address,
    amount,
  );

  const published = await pool.queryFilter(pool.filters.CommitmentsPublished());
  const payouts = await pool.queryFilter(pool.filters.Withdraw());

  rows.push({
    step: 'summary',
    actor: '',
    call: '',
    nullifier_source: `commitments published: ${published[0].args.commitments.length}`,
    recipient: '',
    amount_wei: '',
    outcome: `payouts: ${payouts.length}`,
    revert_reason: '',
    gas_used: '',
    pool_balance_after_wei: (await ethers.provider.getBalance(pool.address)).toString(),
    tx_hash: '',
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
