require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

import fs from 'fs';
import path from 'path';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import { runProver } from '../clients/prover/halo2ProverClient';

const web3 = new Web3('http://127.0.0.1:8545');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');
const RESULT_DIR = path.resolve(PROJECT_ROOT, 'experiments/results/quantitative');
const MULTIPOOL_DIR = path.resolve(RESULT_DIR, 'multipool');

const POOL_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json'),
);

const PROGRAMS = [
  { name: 'IT Faculty Scholarship', studentCount: 20 },
  { name: 'Academic Encouragement Scholarship', studentCount: 15 },
  { name: 'Hardship Scholarship', studentCount: 10 },
];

const TOTAL_STUDENTS = PROGRAMS.reduce((a, c) => a + c.studentCount, 0);

const SOURCE_DATASET = path.resolve(DATA_DIR, 'dataset_n50.json');

const FUNDING_PER_POOL = web3.utils.toWei('1', 'ether');

function step(message: string) {
  process.stderr.write('  ' + message + '\n');
}

async function callRpc(method: string, params: any[] = []): Promise<any> {
  const response: any = await (web3.currentProvider as any).request({
    method,
    params,
  });

  return response && typeof response === 'object' && 'result' in response ? response.result : response;
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

  console.error(`[K0] ${addresses.length}/${addresses.length} wallets are ` + 'Ganache accounts - PASS');
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

    result.push({ ...program, students: groupStudents });
  }

  console.error(`[split] ${TOTAL_STUDENTS} students -> ` + PROGRAMS.map((c) => c.studentCount).join(' + '));

  return result;
}

function generateProofs(programs: any[]) {
  for (const program of programs) {
    console.error(`\n[proof] ${program.name} - ${program.studentCount} students ...`);

    const commitments: string[] = program.students.map(
      (student: any) =>
        runProver('commitment', {
          student_id: student.note.student_id,
          amount: String(student.note.amount),
          rho: String(student.note.rho),
        }).commitment,
    );

    program.commitments = commitments;

    const proofs: any[] = [];

    for (let i = 0; i < program.students.length; i++) {
      const student = program.students[i];

      step(`proof ${i + 1}/${program.studentCount}`);

      const proof = runProver('prove', {
        student_id: student.note.student_id,
        amount: String(student.note.amount),
        rho: String(student.note.rho),
        commitments,
        merkle_index: i,
        recipient: student.address,
      });

      const verification = runProver('verify', {
        proof: proof.proof,
        root: proof.root,
        nullifier: proof.nullifier,
        amount: proof.amount,
        recipient: proof.recipient,
      });

      if (!verification.verified) {
        throw new Error(`${program.name}: proof ${i} failed off-chain verification`);
      }

      proofs.push({
        student_index: i,
        address: student.address,
        amountWei: String(student.note.amount),
        root: proof.root,
        nullifier: proof.nullifier,
      });
    }

    program.proofs = proofs;
    program.root = proofs[0].root;

    for (const p of proofs) {
      if (p.root !== program.root) {
        throw new Error(`${program.name}: proofs disagree on root - ` + 'Merkle index numbering is wrong');
      }
    }
  }

  const roots = programs.map((p: any) => p.root);
  if (new Set(roots).size !== roots.length) {
    throw new Error('Two programs produced the same Merkle root - the isolation ' + 'check would be meaningless');
  }
}

async function deployPool(from: string, value: string) {
  const contract = new web3.eth.Contract(POOL_ARTIFACT.abi);

  const deployTx = contract.deploy({
    data: POOL_ARTIFACT.bytecode,
    arguments: ['0'],
  });

  const estimate = await deployTx.estimateGas({ from, value });

  let receipt: any = null;

  const instance = await deployTx
    .send({ from, value, gas: (Number(estimate) + 1000000) as unknown as string })
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
  const file = path.resolve(RESULT_DIR, 'gas_offchain_raw.csv');

  if (!fs.existsSync(file)) {
    return null;
  }

  const lines = String(fs.readFileSync(file, 'utf8'))
    .split('\n')
    .filter((l: string) => l.trim().length > 0);

  if (lines.length < 2) {
    return null;
  }

  const columns = String(lines[0]).split(',');

  function mean(name: string) {
    const i = columns.indexOf(name);
    if (i < 0) {
      return null;
    }

    const values: number[] = [];

    for (let k = 1; k < lines.length; k++) {
      const raw = String(lines[k]).split(',')[i];
      const v = Number(raw);
      if (raw !== undefined && raw !== '' && Number.isFinite(v) && v > 0) {
        values.push(v);
      }
    }

    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  }

  const withdraw = mean('withdraw_gas');
  const pool = mean('deploy_pool_gas');
  const root = mean('update_root_gas');

  if (withdraw === null || pool === null || root === null) {
    return null;
  }

  return {
    withdraw_gas: withdraw,
    deploy_pool_gas: pool,
    update_root_gas: root,
    deploy_verifier_gas: null,
    total: PROGRAMS.length * pool + PROGRAMS.length * root + TOTAL_STUDENTS * withdraw,
  };
}

async function main() {
  console.error('='.repeat(64));
  console.error('SCENARIO 2 - MULTIPLE POOLS IN PARALLEL (OFF-CHAIN)');
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
    for (let i = 0; i < programs.length; i++) {
      const program = programs[i];

      const pool = await deployPool(school, FUNDING_PER_POOL);

      program.pool = pool.instance;
      program.poolAddress = pool.address;
      measuredTotal += pool.gasUsed;

      console.error(`[deploy] ${program.name}: ` + `${pool.gasUsed.toLocaleString('en-US')} gas`);
    }

    for (const program of programs) {
      const receipt = await program.pool.methods
        .updateRoot(program.root, program.commitments ?? [])
        .send({ from: school, gas: 800000 });

      measuredTotal += Number(receipt.gasUsed);

      console.error(`[root] ${program.name}: ` + `${Number(receipt.gasUsed).toLocaleString('en-US')} gas`);
    }

    for (let a = 0; a < programs.length; a++) {
      for (let b = 0; b < programs.length; b++) {
        const known = await programs[a].pool.methods.validRoot(programs[b].root).call();

        const expected = a === b;

        if (Boolean(known) !== expected) {
          throw new Error(
            `Pool isolation FAILED: pool ${a} ` + (expected ? 'does not know' : 'knows') + ` root of pool ${b}`,
          );
        }
      }
    }

    console.error('[isolation] each pool knows only its own root - PASS');

    const largestProgram = Math.max(...programs.map((c: any) => c.studentCount));

    let order = 0;

    console.error('\n[withdraw] interleaving three pools ...');

    for (let i = 0; i < largestProgram; i++) {
      for (let k = 0; k < programs.length; k++) {
        const program = programs[k];

        if (i >= program.studentCount) {
          continue;
        }

        const p = program.proofs[i];

        const t0 = performance.now();

        const receipt = await program.pool.methods
          .withdrawOffChain(p.root, p.nullifier, p.address, p.amountWei)
          .send({ from: school, gas: 500000 });

        const ms = performance.now() - t0;
        const gas = Number(receipt.gasUsed);

        measuredTotal += gas;
        order++;

        csvLines.push(
          [
            k,
            `"${program.name}"`,
            program.studentCount,
            i,
            order,
            gas,
            ms.toFixed(2),
            p.root,
            p.nullifier,
            school,
            Number(receipt.blockNumber),
            RUN_MODE,
          ].join(','),
        );
      }
    }

    console.error(`[withdraw] done, ${order} withdrawals`);

    const crossChecks: any[] = [];

    for (let a = 0; a < programs.length; a++) {
      for (let b = 0; b < programs.length; b++) {
        if (a === b) {
          continue;
        }

        const used = await programs[a].pool.methods.usedNullifier(programs[b].proofs[0].nullifier).call();

        crossChecks.push({ pool: a, nullifier_of_pool: b, used });

        if (Boolean(used)) {
          throw new Error(`Nullifier isolation FAILED: pool ${a} sees ` + `nullifier of pool ${b}`);
        }
      }
    }

    console.error('[isolation] nullifier ledgers are separate - PASS');

    fs.writeFileSync(path.resolve(MULTIPOOL_DIR, 'multipool_raw.csv'), csvLines.join('\n') + '\n');

    const predicted = predictFromUnitCosts();

    const summary: any = {
      contribution2: {
        question:
          'Experimental evaluation of the trade-off between ' +
          'on-chain and off-chain verification in terms of cost, ' +
          'deployability and scalability ' +
          '(00_contributions.md lines 43-44)',
        axis: 'SCALABILITY - proposition B',
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
        weaker_than_onchain:
          "This branch has NO negative test 'a VALID proof from " +
          "pool A rejected by pool B' - withdrawOffChain takes no " +
          'proof, so there is no proof to misplace. Isolation ' +
          'here rests on validRoot and usedNullifier only, which ' +
          'the university itself supplies. ADV blocks MISTAKES; ' +
          'ONC blocks MALICE too.',
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

      scenario: 'multipool (SCENARIO 2) - off-chain',
      program: PROGRAMS.map((c) => ({
        name: c.name,
        student_count: c.studentCount,
      })),
      total_students: TOTAL_STUDENTS,
      pool_count: PROGRAMS.length,
      shared_verifier: null,
      shared_verifier_note: 'ADV has no verifier contract - this assertion does not ' + 'apply to the off-chain branch',
      interleaved_withdrawals: true,
      root_isolation_verified: true,
      nullifier_isolation_verified: true,
      cross_checks: crossChecks,
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
          : 'SIGNIFICANT DEVIATION - investigate before using ' + 'these numbers';

      console.error(`total gas PREDICTED : ` + `${Math.round(predicted.total).toLocaleString('en-US')}`);
      console.error(
        `difference          : ` + `${Math.round(diff).toLocaleString('en-US')}` + ` (${percent.toFixed(3)} %)`,
      );
      console.error(`=> ${summary.verdict}`);
    } else {
      summary.note =
        'gas_offchain_raw.csv missing, cannot cross-check. ' + 'Run `npm run experiment:quantitative` first.';
      console.error('\n⚠️  gas_offchain_raw.csv missing - cannot cross-check');
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
