require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

import fs from 'fs';
import path from 'path';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import {
  normalizeCalldata,
  extractPublicInputs,
  extractRootAndNullifier,
  verifyProofByCall,
  withdrawWithProofData,
  verifyAndRecordWithProofData,
  settleByNullifier,
} from '../clients/blockchain/shieldedPoolClient';

const web3 = new Web3('http://127.0.0.1:8545');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const RESULT_DIR = path.resolve(PROJECT_ROOT, 'experiments/results/quantitative');

const POOL_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json'),
);

const VERIFIER_ARTIFACT = require(
  path.resolve(PROJECT_ROOT, 'contracts/artifacts/contracts/Halo2Verifier.sol/Halo2Verifier.json'),
);

const DEFAULT_SCENARIOS = [1, 10, 30, 60, 100, 500];

const SCENARIOS: number[] = process.env.SCENARIOS
  ? String(process.env.SCENARIOS)
      .split(',')
      .map((x: string) => parseInt(x.trim(), 10))
      .filter((x: number) => DEFAULT_SCENARIOS.indexOf(x) !== -1)
  : DEFAULT_SCENARIOS;

const CSV_HEADER =
  'mechanism,n,student_index,deploy_pool_gas,deploy_verifier_gas,' +
  'update_root_gas,verify_gas,verify_onchain_ms,withdraw_gas,' +
  'withdraw_ms,verify_record_gas,verify_record_ms,settle_gas,' +
  'settle_ms,root,nullifier\n';

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
          ' "test test ... junk", derivation path' +
          " m/44'/60'/0'/0/{index} — see" +
          ' prepareExperimentInputs.ts.',
        'Running on would measure the WRONG system: dataset wallets become unknown wallets (balance' +
          ' 0), every withdrawal pays an extra 25 000 gas for EIP-161 account' +
          ' creation, and the results become incomparable with the' +
          ' qualitative experiment.',
        'Fix: restart Ganache with:',
        '  ganache --wallet.mnemonic "test test test test test' +
          ' test test test test test test junk"' +
          ' --wallet.totalAccounts 501',
      ].join('\n'),
    );
  }
}

import { runProver } from '../clients/prover/halo2ProverClient';

function loadCommitments(n: number, datasetFile?: string): string[] {
  const file = datasetFile ?? path.resolve(PROJECT_ROOT, 'experiments', 'data', `dataset_n${n}.json`);

  const dataset = JSON.parse(fs.readFileSync(file, 'utf8'));

  return dataset.students.map((student: any) => String(runProver('commitment', student.note).commitment));
}

function loadProofs(n: number) {
  const file = path.resolve(RESULT_DIR, `proofs_n${n}.json`);

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function deployContract(artifact: any, args: any[], from: string, value: string = '0') {
  const contract = new web3.eth.Contract(artifact.abi);

  const deployTx = contract.deploy({
    data: artifact.bytecode,
    arguments: args,
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

async function measureVerify(verifierAddress: string, proofData: any, from: string) {
  const proofAndSignals = normalizeCalldata(proofData);

  const t0 = performance.now();

  const callResult = await verifyProofByCall(verifierAddress, proofAndSignals);

  const verifyTimeMs = performance.now() - t0;

  const estimatedGas = await web3.eth.estimateGas({
    from,
    to: verifierAddress,
    data: proofAndSignals,
  });

  const receipt = await web3.eth.sendTransaction({
    from,
    to: verifierAddress,
    data: proofAndSignals,
    gas: Number(estimatedGas) + 100000,
  });

  return {
    callResult,
    verifyTimeMs,
    verifyGas: Number(receipt.gasUsed),
  };
}

type MeasurementRow = {
  warmup: boolean;
  iteration: number;
  row: string;
};

type ScenarioOptions = {
  verifierArtifact?: any;
  warmupCount?: number;
  datasetPath?: string;
};

async function measureScenario(
  n: number,
  proofs: any[],
  school: string,
  accounts: string[],
  options: ScenarioOptions = {},
) {
  const verifierArtifact = options.verifierArtifact ?? VERIFIER_ARTIFACT;

  const warmupCount = options.warmupCount ?? 0;

  const gasRows: MeasurementRow[] = [];

  if (proofs.length === 0) {
    throw new Error(`No proofs found for n=${n}`);
  }

  const firstProofAndSignals = normalizeCalldata(proofs[0]);

  const { root: scenarioRoot } = extractRootAndNullifier(firstProofAndSignals);

  const totalAmount = proofs.reduce(
    (sum: bigint, p: any) => sum + BigInt(extractPublicInputs(normalizeCalldata(p)).amountWei),
    BigInt(0),
  );

  const poolValue = (totalAmount + totalAmount / BigInt(n)).toString();

  const verifierDeploy = await deployContract(verifierArtifact, [], school);

  console.log('Verifier:', verifierDeploy.address);

  console.log('Verifier deploy gas:', verifierDeploy.gasUsed);

  const poolDeploy = await deployContract(POOL_ARTIFACT, [verifierDeploy.address, '0'], school, poolValue);

  const pool = poolDeploy.instance;

  console.log('Pool:', poolDeploy.address);

  console.log('Pool deploy gas:', poolDeploy.gasUsed);

  const commitments = loadCommitments(n, options.datasetPath);

  const updateRootTx = await pool.methods.updateRoot!(scenarioRoot, commitments).send({
    from: school,
    gas: 30000000 as unknown as string,
  });

  const updateRootGas = Number(updateRootTx.gasUsed);

  console.log('Root updated:', scenarioRoot);

  const measureProof = async (proofData: any) => {
    const proofAndSignals = normalizeCalldata(proofData);

    const { root, nullifier, amountWei } = extractPublicInputs(proofAndSignals);

    const recipient = proofData.address || accounts[2];

    const verifyResult = await measureVerify(verifierDeploy.address!, proofData, school);

    const proofSnapshotId = await callRpc('evm_snapshot');

    if (!proofSnapshotId) {
      throw new Error(
        'Ganache returned no snapshot id before proof' +
          ' student_index=' +
          proofData.student_index +
          ' (n = ' +
          n +
          '). The two designs cannot be measured from' +
          ' the same state => verify_record_gas +' +
          ' settle_gas is not comparable with withdraw_gas.' +
          ' Stopping instead of producing wrong numbers.',
      );
    }

    const tVerifyRecord = performance.now();

    const verifyRecordResult = await verifyAndRecordWithProofData(pool, proofData, recipient, amountWei, school);

    const verifyRecordTimeMs = performance.now() - tVerifyRecord;

    const tSettle = performance.now();

    const settleResult = await settleByNullifier(pool, nullifier, school);

    const settleTimeMs = performance.now() - tSettle;

    const proofReverted = await callRpc('evm_revert', [proofSnapshotId]);

    if (proofReverted !== true) {
      throw new Error(
        'evm_revert returned ' +
          JSON.stringify(proofReverted) +
          ' after the split design (n = ' +
          n +
          ', student_index = ' +
          proofData.student_index +
          '). The nullifier is STILL' +
          ' marked, so the following `withdraw` would revert and' +
          ' withdraw_gas would be garbage. Stopping.',
      );
    }

    const tWithdraw = performance.now();

    const withdrawResult = await withdrawWithProofData(pool, proofData, recipient, amountWei, school);

    const withdrawTimeMs = performance.now() - tWithdraw;

    console.log(
      [
        `n=${n}`,
        `student_index=${proofData.student_index}`,
        `verifyGas=${verifyResult.verifyGas}`,
        `withdrawGas=${withdrawResult.gasUsed}`,
        `verifyRecordGas=${verifyRecordResult.gasUsed}`,
        `settleGas=${settleResult.gasUsed}`,
      ].join(', '),
    );

    return [
      'onchain',
      n,
      proofData.student_index,
      poolDeploy.gasUsed,
      verifierDeploy.gasUsed,
      updateRootGas,
      verifyResult.verifyGas,
      verifyResult.verifyTimeMs.toFixed(6),
      withdrawResult.gasUsed,
      withdrawTimeMs.toFixed(6),
      Number(verifyRecordResult.gasUsed),
      verifyRecordTimeMs.toFixed(6),
      Number(settleResult.gasUsed),
      settleTimeMs.toFixed(6),
      root,
      nullifier,
    ].join(',');
  };

  for (let w = 0; w < warmupCount; w += 1) {
    const warmupSnapshotId = await callRpc('evm_snapshot');

    if (!warmupSnapshotId) {
      throw new Error('Ganache returned no snapshot id before warm-up (n = ' + n + '). Stopping.');
    }

    console.log(`warm-up ${w + 1}/${warmupCount}`);

    gasRows.push({
      warmup: true,

      iteration: w + 1,

      row: await measureProof(proofs[w % proofs.length]),
    });

    const warmupReverted = await callRpc('evm_revert', [warmupSnapshotId]);

    if (warmupReverted !== true) {
      throw new Error(
        'evm_revert after warm-up returned ' +
          JSON.stringify(warmupReverted) +
          ' (n = ' +
          n +
          '). The warm-up nullifier is STILL set. Stopping.',
      );
    }
  }

  for (let i = 0; i < proofs.length; i += 1) {
    gasRows.push({
      warmup: false,

      iteration: warmupCount + i + 1,

      row: await measureProof(proofs[i]),
    });
  }

  return {
    gasRows,

    verifierDeployGas: verifierDeploy.gasUsed,

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
    new Set(SCENARIOS.flatMap((n: number) => loadProofs(n).map((p: any) => p.address))),
  ).filter(Boolean) as string[];

  await assertMeasurementEnvironment(allAddresses);

  console.log('Measurement environment OK: all ' + allAddresses.length + ' dataset wallets are Ganache accounts.');

  const csvPath = path.resolve(RESULT_DIR, 'gas_onchain_raw.csv');

  let csv = CSV_HEADER;

  for (const n of SCENARIOS) {
    const snapshotId = await callRpc('evm_snapshot');

    if (!snapshotId) {
      throw new Error(
        'Ganache returned no snapshot id before n = ' +
          n +
          '. Cannot reset between scenarios => withdraw_gas' +
          ' would depend on run order. Stopping instead of producing wrong numbers.',
      );
    }

    console.log(`\n==============================`);
    console.log(`Scenario n = ${n}`);
    console.log(`==============================`);

    const scenarioResult = await measureScenario(n, loadProofs(n), school!, accounts);

    csv += scenarioResult.gasRows
      .filter((d: MeasurementRow) => !d.warmup)
      .map((d: MeasurementRow) => d.row + '\n')
      .join('');

    fs.writeFileSync(csvPath, csv);

    const scenarioRows = csv
      .trim()
      .split('\n')
      .slice(1)
      .filter((row: string) => row.split(',')[1] === String(n));

    const csvPathForN = path.resolve(RESULT_DIR, `gas_onchain_n${n}.csv`);

    fs.writeFileSync(csvPathForN, CSV_HEADER + scenarioRows.join('\n') + '\n');

    console.log(`Written n = ${n} -> ${csvPath}` + ` and ${csvPathForN}` + ` (${scenarioRows.length} rows)`);

    const reverted = await callRpc('evm_revert', [snapshotId]);

    if (reverted !== true) {
      throw new Error(
        'evm_revert returned ' +
          JSON.stringify(reverted) +
          ' after n = ' +
          n +
          ' (expected true). The chain was NOT' +
          ' cleaned up, so the next scenario would measure wrong numbers. Stopping.',
      );
    }

    console.log(`Chain reverted to a clean state after n = ${n}`);
  }

  console.log('\nGas benchmark finished.');

  console.log(`Saved: ${csvPath}`);
}

export { measureScenario, loadCommitments, callRpc, assertMeasurementEnvironment, CSV_HEADER };

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error);
    process.exit(1);
  });
}
