import fs from 'fs';
import path from 'path';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import http from 'http';
(http.globalAgent as http.Agent & { keepAlive: boolean }).keepAlive = false;

const web3 = new Web3('http://127.0.0.1:8545');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const RESULT_DIR = path.resolve(PROJECT_ROOT, 'experiments', 'results', 'quantitative');

const MULTIPOOL_DIR = path.resolve(RESULT_DIR, 'multipool');

const POOL_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts', 'artifacts', 'contracts', 'ShieldedPool.sol', 'ShieldedPool.json'),
);

const PROGRAMS = [
  { n: 10, name: 'Academic Encouragement Scholarship (n=10)' },
  { n: 30, name: 'IT Faculty Scholarship (n=30)' },
  { n: 60, name: 'Hardship Scholarship (n=60)' },
  { n: 100, name: 'Talent Scholarship (n=100)' },
  { n: 500, name: 'Broad-based Scholarship (n=500)' },
];

const TOTAL_WITHDRAWALS = PROGRAMS.reduce((a, c) => a + c.n, 0);

const OPERATOR_INDEXES = [0, 1, 2, 3, 4, 5];

const FUNDING_PER_POOL = web3.utils.toWei('2', 'ether');

async function assertBlockTimeMode(accounts: string[]) {
  console.error('\n[check] Does Ganache put several transactions into one block...');

  const receipts = await Promise.all(
    [0, 1, 2].map((i) =>
      web3.eth.sendTransaction({
        from: accounts[i + 10]!,
        to: accounts[i + 20]!,
        value: '1',
      }),
    ),
  );

  const blocks = receipts.map((r: any) => Number(r.blockNumber));
  const span = Math.max(...blocks) - Math.min(...blocks) + 1;

  console.error(`[check] 3 parallel transactions -> block ${blocks.join(', ')}` + `  (block_span = ${span}/3)`);

  if (span >= 3) {
    throw new Error(
      '\n🔴 GANACHE IS INSTAMINING — one block per transaction.\n' +
        '   In this mode the block count ALWAYS equals the transaction count, whether\n' +
        '   the pools run in parallel or not => the number is a GANACHE ARTIFACT,\n' +
        '   not a system property, and any conclusion drawn from it is WRONG.\n\n' +
        '   Restart Ganache with `--miner.blockTime 2`:\n\n' +
        '   ganache --wallet.totalAccounts 501 \\\n' +
        '     --wallet.mnemonic "test test test test test test test test test test test junk" \\\n' +
        '     --miner.blockTime 2\n',
    );
  }

  console.error('[check] OK — Ganache puts several transactions into one block.\n');
}

function readProofs(n: number) {
  const f = path.resolve(RESULT_DIR, `proofs_offchain_n${n}.json`);

  if (!fs.existsSync(f)) {
    throw new Error(`Missing ${f}. Run \`npm run experiment:quantitative\` first.`);
  }

  const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.proofs;

  if (!list || list.length < n) {
    throw new Error(`proofs_offchain_n${n}.json has only ${list ? list.length : 0} proofs, ${n} needed`);
  }

  return list;
}

async function deployContract(artifact: any, args: any[], from: string, value: string = '0') {
  const contract = new web3.eth.Contract(artifact.abi);

  const deployTx = contract.deploy({
    data: artifact.bytecode,
    arguments: args,
  });

  const estimate = await deployTx.estimateGas({ from, value });

  let receipt: any = null;

  const instance = await deployTx
    .send({
      from,
      value,
      gas: (Number(estimate) + 1000000) as unknown as string,
    })
    .on('receipt', (r: any) => {
      receipt = r;
    });

  return {
    instance,
    address: instance.options.address,
    gasUsed: Number(receipt.gasUsed),
  };
}

async function main() {
  fs.mkdirSync(MULTIPOOL_DIR, { recursive: true });

  const accounts = await web3.eth.getAccounts();

  if (accounts.length < 501) {
    throw new Error(
      `Ganache has only ${accounts.length} wallets, 501 needed.` + ' Restart it with --wallet.totalAccounts 501',
    );
  }

  await assertBlockTimeMode(accounts);

  const pools: any[] = [];

  for (let i = 0; i < PROGRAMS.length; i++) {
    const programInfo = PROGRAMS[i] as any;
    const walletIndex = OPERATOR_INDEXES[i] as number;
    const wallet = String(accounts[walletIndex]);

    const deployed = await deployContract(POOL_ARTIFACT, ['0'], wallet, FUNDING_PER_POOL);

    pools.push({
      ...programInfo,
      wallet,
      walletIndex,
      instance: deployed.instance,
      address: deployed.address,
      deployGas: deployed.gasUsed,
      proofs: readProofs(programInfo.n).slice(0, programInfo.n),
    });

    console.error(
      `[deploy] ${programInfo.name}  wallet=accounts[${walletIndex}]` +
        `  ${deployed.gasUsed.toLocaleString('en-US')} gas`,
    );
  }

  for (const p of pools) {
    await p.instance.methods.updateRoot(p.proofs[0].root, []).send({ from: p.wallet, gas: 3000000 });
  }

  console.error(`\n[root] root approved for ${pools.length} pools\n`);

  const rows: any[] = [];
  const maxN = Math.max(...PROGRAMS.map((p) => p.n));

  const startedAt = performance.now();

  for (let i = 0; i < maxN; i++) {
    const activePools = pools.filter((p) => i < p.n);

    const result = await Promise.all(
      activePools.map(async (p: any) => {
        const pr = p.proofs[i];
        const t0 = performance.now();

        const receipt = await p.instance.methods
          .withdrawOffChain(pr.root, pr.nullifier, p.wallet, String(pr.amountWei))
          .send({ from: p.wallet, gas: 3000000 });

        return {
          pool_index: p.n,
          program: p.name,
          student_count: p.n,
          student_index: i,
          withdraw_gas: Number(receipt.gasUsed),
          withdraw_ms: (performance.now() - t0).toFixed(2),
          root: pr.root,
          nullifier: pr.nullifier,
          school_account: p.wallet,
          block_number: Number(receipt.blockNumber),
          run_mode: 'parallel',
        };
      }),
    );

    rows.push(...result);

    if (i % 50 === 0 || i === maxN - 1) {
      console.error(`[withdraw] round ${i + 1}/${maxN}` + `  — ${rows.length}/${TOTAL_WITHDRAWALS} transactions`);
    }
  }

  const totalMs = performance.now() - startedAt;

  const header =
    'pool_index,program,student_count,student_index,withdraw_order,' +
    'withdraw_gas,withdraw_ms,root,nullifier,' +
    'school_account,block_number,run_mode\n';

  const csv =
    header +
    rows
      .map((r, idx) =>
        [
          r.pool_index,
          `"${r.program}"`,
          r.student_count,
          r.student_index,
          idx + 1,
          r.withdraw_gas,
          r.withdraw_ms,
          r.root,
          r.nullifier,
          r.school_account,
          r.block_number,
          r.run_mode,
        ].join(','),
      )
      .join('\n') +
    '\n';

  const fCsv = path.resolve(MULTIPOOL_DIR, 'parallel_raw.csv');
  fs.writeFileSync(fCsv, csv);

  const blocks = rows.map((r) => r.block_number);
  const blockSpan = Math.max(...blocks) - Math.min(...blocks) + 1;
  const separateBlocks = new Set(blocks).size;

  const byBlock: any = {};

  rows.forEach((r) => {
    (byBlock[r.block_number] = byBlock[r.block_number] || new Set()).add(r.pool_index);
  });

  const multiPoolBlocks = Object.entries(byBlock).filter(([, s]: any) => s.size > 1);

  const distribution: any = {};

  Object.values(byBlock).forEach((s: any) => {
    distribution[s.size] = (distribution[s.size] || 0) + 1;
  });

  const gas = rows.map((r) => r.withdraw_gas);

  const summary = {
    mechanism: 'offchain',
    axis: '3 - Scalability',
    question: 'Does opening another program make the existing programs SLOWER?',

    pool_count: pools.length,
    total_transactions: rows.length,
    total_time_ms: Math.round(totalMs),

    blocks_with_multiple_pools: multiPoolBlocks.length,
    pools_per_block_distribution: distribution,
    distinct_blocks: separateBlocks,
    avg_transactions_per_block: Math.round((rows.length / separateBlocks) * 100) / 100,

    block_span_not_a_conclusion: blockSpan,

    withdraw_gas: {
      min: Math.min(...gas),
      max: Math.max(...gas),
      range: Math.max(...gas) - Math.min(...gas),
    },

    conclusion:
      multiPoolBlocks.length > 0
        ? `${multiPoolBlocks.length} blocks contain transactions from SEVERAL different pools` +
          ' => the programs do NOT wait for each other.'
        : 'NO block contains transactions from several pools' +
          ' => they still wait for each other. Check the Ganache configuration.',

    forbidden_claims: [
      "'Parallel, so throughput grows with the number of pools' - WRONG. The EVM still" +
        ' executes sequentially within a block and total gas per block is still capped at 30 M.' +
        ' What improves is LATENCY. The throughput ceiling belongs to Axis 2.',

      'Using `block_span` as a conclusion - WRONG. Under --miner.blockTime,' +
        ' Ganache mines blocks ON A CLOCK, so block_span grows merely because' +
        ' time passes. The right metric is `blocks_with_multiple_pools`.',

      'Comparing `withdraw_ms` of this run with the main run - WRONG, it is inflated' +
        ' by waiting for the block clock.',
    ],

    disclosures: {
      verification_mechanism:
        'This branch verifies the proof OFF-CHAIN in the backend.' +
        ' `withdrawOffChain` takes NO proof calldata - the contract TRUSTS' +
        ' that the backend verified it. This is why ADV is cheaper than ONC, and it MUST be stated' +
        ' alongside every gas figure.',

      signing_wallets:
        'Each pool has its own signing wallet (accounts[0..5]). accounts[1..5] are both' +
        ' recipients and signers - Ganache has only 501 wallets and n=500' +
        ' uses all of accounts[1..500]. Harmless because gas is read from' +
        ' receipt.gasUsed, but it must be stated.',

      within_one_pool:
        'Still SEQUENTIAL - exactly like the real flow, and it keeps the property that' +
        ' the anonymity analysis (order channel) relies on.',
    },
  };

  fs.writeFileSync(path.resolve(MULTIPOOL_DIR, 'parallel_summary.json'), JSON.stringify(summary, null, 2));

  console.error('\n' + '='.repeat(64));
  console.error('RESULT — SCENARIO 3, PARALLEL  (OFF-CHAIN)');
  console.error('='.repeat(64));
  console.error(`pools                      : ${pools.length}`);
  console.error(`total transactions         : ${rows.length}`);
  console.error(`blocks with SEVERAL pools  : ${multiPoolBlocks.length}   <- MAIN METRIC`);
  console.error(`distinct blocks            : ${separateBlocks}`);
  console.error(`transactions / block (avg) : ${summary.avg_transactions_per_block}`);
  console.error(`withdraw_gas range         : ${summary.withdraw_gas.range} gas`);
  console.error('');
  console.error('pools per block distribution:');

  Object.keys(distribution)
    .sort((a, b) => Number(b) - Number(a))
    .forEach((k) => {
      console.error(`  ${k} pools in one block : ${distribution[k]} blocks`);
    });

  console.error('');
  console.error(summary.conclusion);
  console.error('');
  console.error(`Wrote: ${fCsv}`);
}

main().catch((error: any) => {
  console.error(error.message || error);
  process.exit(1);
});
