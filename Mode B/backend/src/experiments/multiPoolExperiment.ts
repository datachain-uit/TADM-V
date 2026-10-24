import fs from 'fs';
import path from 'path';
import http from 'http';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import { spawnSync } from 'child_process';
import { normalizeCalldata, extractPublicInputs } from '../clients/blockchain/shieldedPoolClient';

(http.globalAgent as http.Agent & { keepAlive: boolean }).keepAlive = false;

const web3 = new Web3('http://127.0.0.1:8545');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const DATA_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');

const RESULT_DIR = path.resolve(PROJECT_ROOT, 'experiments/results/quantitative');

const MULTIPOOL_DIR = path.resolve(RESULT_DIR, 'multipool');

const POOL_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json'),
);

const VERIFIER_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts/artifacts/contracts/Halo2Verifier.sol/Halo2Verifier.json'),
);

const PROGRAMS = [
  { name: 'IT Faculty Scholarship', studentCount: 20, fakeN: 9020 },
  { name: 'Academic Encouragement Scholarship', studentCount: 15, fakeN: 9015 },
  { name: 'Hardship Scholarship', studentCount: 10, fakeN: 9010 },
];

const TOTAL_STUDENTS = PROGRAMS.reduce((a, c) => a + c.studentCount, 0);

const SOURCE_DATASET = path.resolve(DATA_DIR, 'dataset_n50.json');

const FUNDING_PER_POOL = web3.utils.toWei('1', 'ether');

async function callRpc(method: string, params: any[]) {
  const response: any = await (web3.currentProvider as any).request({
    method,
    params,
  });

  if (response && typeof response === 'object' && 'result' in response) {
    return response.result;
  }

  return response;
}

async function assertMeasurementEnvironment(addresses: string[]) {
  const accounts: string[] = await web3.eth.getAccounts();

  const accountSet = new Set(accounts.map((a: string) => a.toLowerCase()));

  const missing = addresses.filter((addr: string) => !accountSet.has(addr.toLowerCase()));

  if (missing.length > 0) {
    throw new Error(
      [
        'GANACHE MNEMONIC MISMATCH: ' +
          missing.length +
          '/' +
          addresses.length +
          ' dataset wallets are not Ganache accounts.',
        'First mismatching wallet: ' + missing[0],
        'Running on would measure the WRONG system: every withdrawal' +
          ' would cost an extra 25 000 gas for EIP-161 account' +
          ' creation, making the numbers incomparable with the' +
          ' n-sweep results.',
        'Fix: restart Ganache with:',
        '  ganache --wallet.mnemonic "test test test test test' +
          ' test test test test test test junk"' +
          ' --wallet.totalAccounts 120',
      ].join('\n'),
    );
  }

  console.error(`[K0] ${addresses.length}/${addresses.length} wallets are Ganache accounts - PASS`);
}

function splitDataset() {
  const source = JSON.parse(fs.readFileSync(SOURCE_DATASET, 'utf8'));

  if (!Array.isArray(source.students)) {
    throw new Error('dataset_n50.json has no `students` array');
  }

  if (source.students.length < TOTAL_STUDENTS) {
    throw new Error(`Need ${TOTAL_STUDENTS} students, dataset only has ` + source.students.length);
  }

  if (!fs.existsSync(MULTIPOOL_DIR)) {
    fs.mkdirSync(MULTIPOOL_DIR, { recursive: true });
  }

  const result: any[] = [];
  let offset = 0;

  for (const program of PROGRAMS) {
    const groupStudents = source.students.slice(offset, offset + program.studentCount);
    offset += program.studentCount;

    const subDataset = {
      n: program.fakeN,
      merkle_depth: source.merkle_depth,
      school_account_index: source.school_account_index,
      student_account_offset: source.student_account_offset,
      note:
        'TEMPORARY dataset for the multipool scenario, derived from dataset_n50.' +
        ' `n` = ' +
        program.fakeN +
        ' is deliberately OUTSIDE {1,10,30,60,100,353,500}' +
        ' so bench-from-dataset cannot overwrite the real results.',
      program: program.name,
      students: groupStudents,
    };

    const file = path.resolve(MULTIPOOL_DIR, `dataset_${program.fakeN}.json`);

    fs.writeFileSync(file, JSON.stringify(subDataset, null, 2));

    result.push({ ...program, file, students: groupStudents });
  }

  console.error(`[split] ${TOTAL_STUDENTS} students -> ` + PROGRAMS.map((c) => c.studentCount).join(' + '));

  return result;
}

function proverPath() {
  return path.resolve(
    PROJECT_ROOT,
    process.platform === 'win32' ? 'target/release/prover.exe' : 'target/release/prover',
  );
}

function generateProofs(programs: any[]) {
  for (const program of programs) {
    console.error(`\n[proof] ${program.name} - ${program.studentCount} students ...`);

    const spawnResult = spawnSync(
      proverPath(),
      ['bench-from-dataset', path.relative(path.resolve(PROJECT_ROOT, 'prover'), program.file).replace(/\\/g, '/')],
      {
        cwd: path.resolve(PROJECT_ROOT, 'prover'),
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );

    if (spawnResult.error) {
      throw spawnResult.error;
    }

    if (spawnResult.status !== 0) {
      throw new Error(`prover failed for ${program.name} (dataset ${program.fakeN})`);
    }

    const src = path.resolve(RESULT_DIR, `proofs_n${program.fakeN}.json`);
    const dst = path.resolve(MULTIPOOL_DIR, `proofs_${program.fakeN}.json`);

    if (!fs.existsSync(src)) {
      throw new Error(`Proof file not found: ${src}`);
    }

    fs.renameSync(src, dst);

    const csvSrc = path.resolve(RESULT_DIR, `performance_onchain_n${program.fakeN}.csv`);

    if (fs.existsSync(csvSrc)) {
      fs.renameSync(csvSrc, path.resolve(MULTIPOOL_DIR, `performance_${program.fakeN}.csv`));
    }

    program.proofs = JSON.parse(fs.readFileSync(dst, 'utf8'));

    if (program.proofs.length !== program.studentCount) {
      throw new Error(`${program.name}: expected ${program.studentCount} proofs, got ` + program.proofs.length);
    }
  }
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

function predictFromUnitCosts() {
  const f = path.resolve(RESULT_DIR, 'gas_onchain_raw.csv');

  if (!fs.existsSync(f)) {
    return null;
  }

  const row = String(fs.readFileSync(f, 'utf8'))
    .split('\n')
    .filter((l: string) => l.trim().length > 0);

  if (row.length < 2) {
    return null;
  }

  const columns = String(row[0]).split(',');

  function columnMean(name: string) {
    const i = columns.indexOf(name);
    if (i < 0) {
      return null;
    }

    const value: number[] = [];

    for (let k = 1; k < row.length; k++) {
      const cells = String(row[k]).split(',')[i];
      const v = Number(cells);
      if (cells !== undefined && cells !== '' && Number.isFinite(v) && v > 0) {
        value.push(v);
      }
    }

    return value.length === 0 ? null : value.reduce((a, b) => a + b, 0) / value.length;
  }

  const withdrawn = columnMean('withdraw_gas');
  const pool = columnMean('deploy_pool_gas');
  const verifier = columnMean('deploy_verifier_gas');
  const root = columnMean('update_root_gas');

  if (withdrawn === null || pool === null || verifier === null || root === null) {
    return null;
  }

  return {
    withdraw_gas: withdrawn,
    deploy_pool_gas: pool,
    deploy_verifier_gas: verifier,
    update_root_gas: root,
    total: verifier + PROGRAMS.length * pool + PROGRAMS.length * root + TOTAL_STUDENTS * withdrawn,
  };
}

async function main() {
  console.error('='.repeat(64));
  console.error('SCENARIO 2 - MULTIPLE POOLS IN PARALLEL');
  console.error('='.repeat(64));

  const programs = splitDataset();
  generateProofs(programs);

  const allAddresses: string[] = [];
  for (const program of programs) {
    for (const student of program.students) {
      allAddresses.push(student.address);
    }
  }

  await assertMeasurementEnvironment(allAddresses);

  const accounts: string[] = await web3.eth.getAccounts();

  if (accounts.length === 0) {
    throw new Error('Ganache returned no accounts');
  }

  const school: string = String(accounts[0]);

  const RUN_MODE: string = 'serial';

  const snapshotId = await callRpc('evm_snapshot', []);
  console.error(`[chain] snapshot ${snapshotId}`);

  const csvLines: string[] = [
    'pool_index,program,student_count,student_index,withdraw_order,' +
      'withdraw_gas,withdraw_ms,root,nullifier,' +
      'school_account,block_number,run_mode',
  ];

  let measuredTotal = 0;

  try {
    const verifier = await deployContract(VERIFIER_ARTIFACT, [], school);

    measuredTotal += verifier.gasUsed;

    console.error(`\n[deploy] SHARED verifier: ` + `${verifier.gasUsed.toLocaleString('en-US')} gas`);

    for (const program of programs) {
      const pool = await deployContract(POOL_ARTIFACT, [verifier.address, '0'], school, FUNDING_PER_POOL);

      program.pool = pool.instance;
      program.poolAddress = pool.address;
      measuredTotal += pool.gasUsed;

      console.error(`[deploy] ${program.name}: ` + `${pool.gasUsed.toLocaleString('en-US')} gas`);
    }

    for (const program of programs) {
      const root = extractPublicInputs(normalizeCalldata(program.proofs[0])).root;

      const receipt = await program.pool.methods.updateRoot(root, []).send({ from: school, gas: 500000 });

      program.root = root;
      measuredTotal += Number(receipt.gasUsed);

      console.error(`[root] ${program.name}: ${Number(receipt.gasUsed).toLocaleString('en-US')} gas`);
    }

    const largestProgram = Math.max(...programs.map((c: any) => c.studentCount));

    let order = 0;

    console.error('\n[withdraw] interleaving three pools ...');

    for (let i = 0; i < largestProgram; i++) {
      for (const program of programs) {
        if (i >= program.studentCount) {
          continue;
        }

        const calldata = normalizeCalldata(program.proofs[i]);
        const publicInputs = extractPublicInputs(calldata);

        const t0 = performance.now();

        const receipt = await program.pool.methods
          .withdraw(
            calldata,
            publicInputs.root,
            publicInputs.nullifier,
            program.students[i].address,
            publicInputs.amountWei,
          )
          .send({ from: school, gas: 3000000 });

        const ms = performance.now() - t0;
        const gas = Number(receipt.gasUsed);

        measuredTotal += gas;
        order++;

        csvLines.push(
          [
            program.fakeN,
            `"${program.name}"`,
            program.studentCount,
            i,
            order,
            gas,
            ms.toFixed(2),
            publicInputs.root,
            publicInputs.nullifier,
            school,
            Number(receipt.blockNumber),
            RUN_MODE,
          ].join(','),
        );
      }
    }

    console.error(`[withdraw] done, ${order} withdrawals`);

    const fCsv = path.resolve(MULTIPOOL_DIR, 'multipool_raw.csv');
    fs.writeFileSync(fCsv, csvLines.join('\n') + '\n');

    const predicted = predictFromUnitCosts();

    const summary: any = {
      contribution2: {
        question:
          'Experimental evaluation of the on-chain vs off-chain trade-off ' +
          'in cost, deployability and ' +
          'scalability (00_contributions.md lines 43-44)',
        axis: 'SCALABILITY — claim B',
        what_it_proves:
          'The n-sweep only measures WITHIN ONE POOL, at most 512 ' +
          'students (MERKLE_DEPTH = 9). This scenario proves that ' +
          'going past 512 by ADDING POOLS is valid: the total ' +
          'cost equals the sum of the parts, with no cross-pool ' +
          'cost. => cost is linear in the total number of ' +
          'students, with NO ceiling on scale.',
        turns_the_formula_from: 'ASSUMPTION (arithmetic on paper) -> VERIFIED (measured)',
        what_it_does_not_prove:
          'Says NOTHING about cheap vs expensive - that is the COST ' +
          'axis. Says NOTHING about mainnet - Ganache does not ' +
          'represent gas price or network congestion.',
        sentence_allowed:
          'The pools are independent, so a program with more than ' +
          '512 students can be split across several pools without ' +
          'them affecting each other; cost ADDS UP rather than ' +
          'multiplying.',
        sentence_forbidden:
          "'Scales without limit' - a program over 512 students " +
          'MUST be split across pools: one administrative list ' +
          'becomes two roots and two approval rounds. That is a ' +
          'real operational burden and must be stated.',
      },

      scenario: 'multipool (SCENARIO 2)',
      program: PROGRAMS.map((c) => ({
        name: c.name,
        student_count: c.studentCount,
      })),
      total_students: TOTAL_STUDENTS,
      pool_count: PROGRAMS.length,
      shared_verifier: true,
      interleaved_withdrawals: true,
      total_gas_measured: measuredTotal,
    };

    console.error('\n' + '='.repeat(64));
    console.error('RESULT');
    console.error('='.repeat(64));
    console.error(`total gas MEASURED  : ${measuredTotal.toLocaleString('en-US')}`);

    if (predicted) {
      const diff = measuredTotal - predicted.total;
      const percent = (diff / predicted.total) * 100;

      summary.unit_costs_from_scenario1 = predicted;
      summary.total_gas_predicted = Math.round(predicted.total);
      summary.diff_absolute = Math.round(diff);
      summary.diff_percent = Math.round(percent * 1000) / 1000;
      summary.verdict =
        Math.abs(percent) < 1
          ? 'ADDITIVE FORMULA HOLDS - difference under 1%'
          : 'SIGNIFICANT DEVIATION - find the cause before using these numbers';

      console.error(`total gas PREDICTED : ${Math.round(predicted.total).toLocaleString('en-US')}`);
      console.error(`difference          : ${Math.round(diff).toLocaleString('en-US')}` + ` (${percent.toFixed(3)} %)`);
      console.error(`=> ${summary.verdict}`);
    } else {
      summary.ghi_chu = 'gas_onchain_raw.csv missing, cannot cross-check.' + ' Run `npm run experiment:gas` first.';
      console.error('\n⚠️  gas_onchain_raw.csv missing - cannot cross-check');
    }

    fs.writeFileSync(path.resolve(MULTIPOOL_DIR, 'multipool_summary.json'), JSON.stringify(summary, null, 2));

    console.error(`\nWritten: ${MULTIPOOL_DIR}`);
  } finally {
    await callRpc('evm_revert', [snapshotId]);
    console.error(`[chain] revert ${snapshotId}`);
  }
}

main().catch((e: any) => {
  console.error('\n🔴 FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
