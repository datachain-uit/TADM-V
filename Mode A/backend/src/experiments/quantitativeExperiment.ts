require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

import fs from 'fs';
import path from 'path';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import { runProver } from '../clients/prover/halo2ProverClient';
import { merklePathFromArray } from '../utils/merklePath';

const web3 = new Web3('http://127.0.0.1:8545');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const DATA_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');

const RESULT_DIR = path.resolve(PROJECT_ROOT, 'experiments/results/quantitative');

const POOL_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json'),
);

const SCENARIOS: number[] = process.env.SCENARIOS
  ? String(process.env.SCENARIOS)
      .split(',')
      .map((x: string) => Number(x.trim()))
  : [1, 10, 30, 60, 100, 500];

const CSV_GAS_HEADER =
  'mechanism,n,student_index,deploy_pool_gas,deploy_verifier_gas,' +
  'update_root_gas,verify_gas,verify_onchain_ms,withdraw_gas,' +
  'withdraw_ms,root,nullifier\n';

const PERFORMANCE_CSV_HEADER =
  'mechanism,n,student_index,witness_ms,setup_ms,prove_ms,proof_generation_ms,verify_native_ms,verified,proof_bytes,calldata_bytes,root,nullifier,verify_setup_ms\n';

function step(message: string) {
  process.stderr.write('  ' + message + '\n');
}

async function retry<T>(name: string, task: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: any = null;

  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await task();
    } catch (error: any) {
      const errorCode = String(error?.code || error?.cause?.code || error?.message || '');

      const isConnectionError = /ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT|EPIPE/i.test(errorCode);

      lastError = error;

      if (!isConnectionError || i === attempts) {
        throw error;
      }

      step(
        'connection error at "' + name + '" (attempt ' + i + '/' + attempts + '), waiting 3 seconds before retrying',
      );

      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw lastError;
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

  const unknownAddresses = addresses.filter((dc: string) => !accountSet.has(dc.toLowerCase()));

  if (unknownAddresses.length > 0) {
    throw new Error(
      [
        'GANACHE MNEMONIC MISMATCH: ' +
          unknownAddresses.length +
          '/' +
          addresses.length +
          ' dataset wallets are not Ganache accounts.',
        'First mismatching wallet: ' + unknownAddresses[0],
        'The dataset was generated from the mnemonic' +
          ' "test test ... junk", path' +
          " m/44'/60'/0'/0/{index} — see" +
          ' prepareExperimentInputs.ts.',
        'Continuing would measure the WRONG system: dataset wallets become unknown wallets (balance' +
          ' 0), every withdrawal pays an extra 25 000 gas for EIP-161 account' +
          ' creation, and the results are not comparable with the qualitative' +
          ' experiment.',
        'Fix: restart Ganache with:',
        '  ganache --wallet.mnemonic "test test test test test' +
          ' test test test test test test junk"' +
          ' --wallet.totalAccounts 501',
      ].join('\n'),
    );
  }
}

function readDataset(n: number) {
  const fullPath = path.resolve(DATA_DIR, `dataset_n${n}.json`);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing dataset: ${fullPath}`);
  }

  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

async function deployExperimentPool(from: string, value: string) {
  const contract = new web3.eth.Contract(POOL_ARTIFACT.abi);

  const deployTx = contract.deploy({
    data: POOL_ARTIFACT.bytecode,

    arguments: ['0'],
  });

  const estimatedGas = await deployTx.estimateGas({
    from,
    value,
  });

  let receipt: any = null;

  const instance = await deployTx
    .send({
      from,

      value,

      gas: (Number(estimatedGas) + 1000000) as unknown as string,
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

type MeasurementRow = {
  warmup: boolean;
  iteration: number;
  row: string;
};

type ScenarioOptions = {
  dataset?: any;
  warmupCount?: number;
  writeResultFiles?: boolean;

  warmMode?: boolean;
};

async function runScenario(n: number, school: string, options: ScenarioOptions = {}) {
  const warmupCount = options.warmupCount ?? 0;

  const performanceRow: MeasurementRow[] = [];

  const gasRow: MeasurementRow[] = [];
  console.log(`\n==============================`);

  console.log(`Scenario n = ${n}`);

  console.log(`==============================`);

  const dataset = options.dataset ?? readDataset(n);

  const studentData = dataset.students;

  step(`computing ${n} commitments`);

  const commitments: string[] = studentData.map((student: any) => {
    const result = runProver('commitment', {
      student_id: student.note.student_id,

      amount: String(student.note.amount),

      rho: String(student.note.rho),
    });

    return result.commitment;
  });

  const scenarioTree = runProver('root', {
    commitments,
  });

  const hasStoredTree = Array.isArray(scenarioTree?.nodes) && Array.isArray(scenarioTree?.zeros);

  console.error(
    hasStoredTree
      ? '  tree built once — ' + String(scenarioTree.nodes.length) + ' levels'
      : '  prover returned no nodes — rebuilding for every proof',
  );

  let performanceCsv = PERFORMANCE_CSV_HEADER;

  const proofs: any[] = [];

  const studentPayload = (i: number) => {
    const student = studentData[i];

    return {
      student_id: student.note.student_id,

      amount: String(student.note.amount),

      rho: String(student.note.rho),

      ...(hasStoredTree
        ? {
            commitments: [],
            ...merklePathFromArray(i, scenarioTree.nodes, scenarioTree.zeros),
          }
        : {
            commitments,
          }),

      merkle_index: i,
      recipient: student.address,
    };
  };

  const proveAndVerify = (i: number) => {
    const student = studentData[i];

    const proof = runProver('prove', studentPayload(i));

    const verification = runProver('verify', {
      proof: proof.proof,

      root: proof.root,

      nullifier: proof.nullifier,

      amount: proof.amount,
      recipient: proof.recipient,
    });

    const records = {
      student_index: i,

      address: student.address,

      amountWei: String(student.note.amount),

      ...proof,

      verify_ms: verification.verify_ms,

      verified: verification.verified,
    };

    const row = [
      'offchain',
      n,
      i,
      proof.tree_and_witness_ms.toFixed(6),
      proof.setup_ms.toFixed(6),
      proof.prove_ms.toFixed(6),

      (proof.tree_and_witness_ms + proof.prove_ms).toFixed(6),

      verification.verify_ms.toFixed(6),
      verification.verified,
      proof.proof.length / 2,

      '',

      proof.root,
      proof.nullifier,

      verification.setup_ms.toFixed(6),
    ].join(',');

    return {
      records,
      row,
    };
  };

  const existingProofs: any[] | null = options.warmMode ? [] : null;

  if (existingProofs) {
    const order: number[] = [];

    for (let w = 0; w < warmupCount; w += 1) {
      order.push(w % studentData.length);
    }

    for (let i = 0; i < studentData.length; i += 1) {
      order.push(i);
    }

    step(`warm mode — ONE prove-batch process for ${warmupCount} warm-up` + ` + ${studentData.length} measurements`);

    const batch = runProver(
      'prove-batch',
      order.map((i: number) => studentPayload(i)),
    );

    if (!Array.isArray(batch?.proofs) || batch.proofs.length !== order.length) {
      throw new Error(`prove-batch returned ${batch?.proofs?.length} records,` + ` ${order.length} needed`);
    }

    batch.proofs.forEach((p: any, index: number) => {
      const isWarmup = index < warmupCount;

      const i = order[index] as number;

      const student = studentData[i];

      const row = [
        'offchain',
        n,
        i,
        p.tree_and_witness_ms.toFixed(6),
        batch.setup_ms.toFixed(6),
        p.prove_ms.toFixed(6),
        (p.tree_and_witness_ms + p.prove_ms).toFixed(6),
        p.verify_native_ms.toFixed(6),
        p.verified,
        p.proof.length / 2,
        '',
        p.root,
        p.nullifier,
        '',
      ].join(',');

      performanceRow.push({
        warmup: isWarmup,
        iteration: index + 1,
        row,
      });

      if (!isWarmup) {
        performanceCsv += row + '\n';

        existingProofs.push({
          student_index: i,

          address: student.address,

          amountWei: String(student.note.amount),

          proof: p.proof,
          root: p.root,
          nullifier: p.nullifier,
          amount: p.amount,
          recipient: p.recipient,

          tree_and_witness_ms: p.tree_and_witness_ms,
          setup_ms: batch.setup_ms,
          prove_ms: p.prove_ms,
          total_ms: p.tree_and_witness_ms + batch.setup_ms + p.prove_ms,

          verify_ms: p.verify_native_ms,
          verified: p.verified,
        });
      }
    });

    proofs.push(...existingProofs);
  }

  for (let w = 0; w < (existingProofs ? 0 : warmupCount); w += 1) {
    const i = w % studentData.length;

    step(`warm-up ${w + 1}/${warmupCount} (student_index ${i})`);

    performanceRow.push({
      warmup: true,

      iteration: w + 1,

      row: proveAndVerify(i).row,
    });
  }

  for (let i = 0; i < (existingProofs ? 0 : studentData.length); i += 1) {
    step(`proof ${i + 1}/${n}`);

    const { records, row } = proveAndVerify(i);

    proofs.push(records);

    performanceCsv += row + '\n';

    performanceRow.push({
      warmup: false,

      iteration: warmupCount + i + 1,

      row,
    });
  }

  if (!existingProofs && options.writeResultFiles !== false) {
    fs.writeFileSync(path.resolve(RESULT_DIR, `performance_offchain_n${n}.csv`), performanceCsv);

    fs.writeFileSync(path.resolve(RESULT_DIR, `proofs_offchain_n${n}.json`), JSON.stringify(proofs, null, 2));
  }

  const totalAmount = proofs.reduce((sum: bigint, p: any) => sum + BigInt(p.amountWei), BigInt(0));

  const poolValue = (totalAmount + totalAmount / BigInt(n)).toString();

  step(`deploying pool, funding ${poolValue} wei`);

  const poolDeploy = await retry('deploy pool', () => deployExperimentPool(school, poolValue));

  const pool = poolDeploy.instance;

  console.log('Pool:', poolDeploy.address);

  console.log('Pool deploy gas:', poolDeploy.gasUsed);

  const scenarioRoot = proofs[0].root;

  const updateRootTx: any = await retry('approve root', () =>
    pool.methods.updateRoot!(scenarioRoot, commitments).send({
      from: school,

      gas: 500000 as unknown as string,
    }),
  );

  const updateRootGas = Number(updateRootTx.gasUsed);

  console.log('Root updated:', scenarioRoot);

  let csvGas = '';

  const withdrawOnce = async (p: any) => {
    let tWithdraw = 0;

    const withdraw: any = await retry('withdraw for student ' + p.student_index, () => {
      tWithdraw = performance.now();

      return pool.methods.withdrawOffChain!(p.root, p.nullifier, p.address, p.amountWei).send({
        from: school,

        gas: 500000 as unknown as string,
      });
    });

    const withdrawTimeMs = performance.now() - tWithdraw;

    console.log(
      [
        `n=${n}`,
        `student_index=${p.student_index}`,
        `proveMs=${p.prove_ms.toFixed(1)}`,
        `verifyMs=${p.verify_ms.toFixed(1)}`,
        `withdrawGas=${withdraw.gasUsed}`,
      ].join(', '),
    );

    return [
      'offchain',
      n,
      p.student_index,
      poolDeploy.gasUsed,

      '',

      updateRootGas,

      '',

      '',
      Number(withdraw.gasUsed),
      withdrawTimeMs.toFixed(6),
      p.root,
      p.nullifier,
    ].join(',');
  };

  for (let w = 0; w < warmupCount; w += 1) {
    const snapshotWarmup = await callRpc('evm_snapshot');

    if (!snapshotWarmup) {
      throw new Error('Ganache returned no snapshot id before the gas warm-up (n = ' + n + '). Stopping.');
    }

    step(`withdrawal warm-up ${w + 1}/${warmupCount}`);

    gasRow.push({
      warmup: true,

      iteration: w + 1,

      row: await withdrawOnce(proofs[w % proofs.length]),
    });

    const warmupReverted = await callRpc('evm_revert', [snapshotWarmup]);

    if (warmupReverted !== true) {
      throw new Error(
        'evm_revert after the gas warm-up returned ' +
          JSON.stringify(warmupReverted) +
          ' (n = ' +
          n +
          '). The warm-up nullifier is STILL marked. Stopping.',
      );
    }
  }

  for (let i = 0; i < proofs.length; i += 1) {
    const row = await withdrawOnce(proofs[i]);

    csvGas += row + '\n';

    gasRow.push({
      warmup: false,

      iteration: warmupCount + i + 1,

      row,
    });
  }

  return {
    csvGas,
    performanceRows: performanceRow,
    gasRows: gasRow,
    proofs,
    commitments,

    poolDeployGas: poolDeploy.gasUsed,

    updateRootGas,
  };
}

async function main() {
  fs.mkdirSync(RESULT_DIR, {
    recursive: true,
  });

  const accounts = await web3.eth.getAccounts();

  const school = accounts[0];

  const allAddresses = Array.from(
    new Set(SCENARIOS.flatMap((n: number) => readDataset(n).students.map((student: any) => student.address))),
  ) as string[];

  await assertMeasurementEnvironment(allAddresses);

  console.log('Measurement environment OK: all ' + allAddresses.length + ' dataset wallets are Ganache accounts.');

  console.log('Starting the off-chain quantitative experiment...');

  console.log('School account:', school);

  const csvPath = path.resolve(RESULT_DIR, 'gas_offchain_raw.csv');

  let csvGas = CSV_GAS_HEADER;

  for (const n of SCENARIOS) {
    const fileProof = path.resolve(RESULT_DIR, `proofs_offchain_n${n}.json`);

    const gasFileForN = path.resolve(RESULT_DIR, `gas_offchain_n${n}.csv`);

    if (fs.existsSync(fileProof) && fs.existsSync(gasFileForN)) {
      const oldRow = fs.readFileSync(gasFileForN, 'utf8').trim().split('\n').slice(1);

      csvGas += oldRow.join('\n') + '\n';

      step(
        `SKIPPED n = ${n} — proofs and gas already exist` +
          ` (${oldRow.length} rows read back).` +
          ` Delete proofs_offchain_n${n}.json to rerun.`,
      );

      continue;
    }

    const snapshotId = await callRpc('evm_snapshot');

    if (!snapshotId) {
      throw new Error(
        'Ganache returned no snapshot id before n = ' +
          n +
          '. The chain cannot be reset between scenarios ⇒ withdraw_gas' +
          ' would depend on run order. Stopping instead of producing wrong numbers.',
      );
    }

    csvGas += (await runScenario(n, school!)).csvGas;

    const reverted = await callRpc('evm_revert', [snapshotId]);

    if (reverted !== true) {
      throw new Error(
        'evm_revert returned ' +
          JSON.stringify(reverted) +
          ' after n = ' +
          n +
          ' (expected true). The chain was NOT' +
          ' cleaned up, so the next scenario would measure wrongly. Stopping.',
      );
    }

    step('chain reverted to a clean state after n = ' + n);

    fs.writeFileSync(csvPath, csvGas);

    const scenarioRows = csvGas
      .trim()
      .split('\n')
      .slice(1)
      .filter((row: string) => row.split(',')[1] === String(n));

    const csvPathForN = path.resolve(RESULT_DIR, `gas_offchain_n${n}.csv`);

    fs.writeFileSync(csvPathForN, CSV_GAS_HEADER + scenarioRows.join('\n') + '\n');

    console.log(`Wrote ${n} -> ${csvPath}` + ` and ${csvPathForN}` + ` (${scenarioRows.length} rows)`);
  }

  console.log('\nOff-chain quantitative experiment finished.');

  console.log(`Saved: ${csvPath}`);
}

export { runScenario, assertMeasurementEnvironment, callRpc, readDataset, CSV_GAS_HEADER, PERFORMANCE_CSV_HEADER };

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error);
    process.exit(1);
  });
}
