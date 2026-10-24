import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import { MERKLE_DEPTH, MerkleTree, createCommitment } from '../utils/merkleTree';

(http.globalAgent as any).keepAlive = false;
(https.globalAgent as any).keepAlive = false;

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8546';

const web3 = new Web3(RPC_URL);

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const RESULT_DIR = path.resolve(PROJECT_ROOT, process.env.RESULTS_DIR || 'experiments/results/quantitative');

function proofPathFor(n: number): string {
  const a = path.resolve(RESULT_DIR, `proofs_groth16_n${n}.json`);
  if (fs.existsSync(a)) return a;
  return path.resolve(PROJECT_ROOT, `experiments/results/quantitative/proofs_groth16_n${n}.json`);
}

const VERIFIER_ARTIFACT_PATH = path.resolve(
  PROJECT_ROOT,
  'contracts/artifacts/contracts/Groth16Verifier.sol/Groth16Verifier.json',
);

const POOL_ARTIFACT_PATH = path.resolve(
  PROJECT_ROOT,
  'contracts/artifacts/contracts/ShieldedPoolGroth16.sol/ShieldedPoolGroth16.json',
);

const DATA_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');

const CSV_HEADER =
  'mechanism,n,student_index,' +
  'deploy_pool_gas,deploy_verifier_gas,update_root_gas,' +
  'verify_gas,verify_onchain_ms,' +
  'withdraw_gas,withdraw_ms,' +
  'verify_record_gas,verify_record_ms,' +
  'settle_gas,settle_ms,' +
  'root,nullifier\n';

const SCENARIOS = [1, 10, 30, 60, 100, 500];

function selectScenarios(): number[] {
  const value = process.env.SCENARIOS;

  if (!value) {
    return SCENARIOS;
  }

  return value
    .split(',')
    .map((x: string) => Number(x.trim()))
    .filter((x: number) => SCENARIOS.indexOf(x) !== -1);
}

function splitCalldata(calldata: string) {
  const parsed = JSON.parse('[' + calldata + ']');

  return {
    pA: parsed[0],
    pB: parsed[1],
    pC: parsed[2],
    pubSignals: parsed[3],
  };
}

function toBytes32(x: string): string {
  return web3.utils.padLeft(web3.utils.toHex(BigInt(x)), 64);
}

async function loadCommitments(n: number): Promise<{ values: string[]; root: bigint }> {
  const p = path.resolve(DATA_DIR, `inputs_n${n}.json`);

  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p} - run 'npm run experiment:prepare' first.`);
  }

  const data = JSON.parse(fs.readFileSync(p, 'utf8'));

  const records: any[] = data.inputs ?? [];

  if (records.length !== n) {
    throw new Error(`inputs_n${n}.json has ${records.length} records, expected ${n}.`);
  }

  const commitments: bigint[] = [];

  for (const r of records) {
    const inp = r.input ?? {};

    commitments.push(await createCommitment(inp.student_id, inp.amount, inp.rho));
  }

  const tree = new MerkleTree(MERKLE_DEPTH);

  await tree.insertAll(commitments);

  return {
    values: commitments.map((c: bigint) => toBytes32(c.toString())),
    root: tree.root(),
  };
}

async function rawRpc(method: string, params: any[] = []): Promise<any> {
  const response: any = await (web3.currentProvider as any).request({
    method,
    params,
  });

  return response && typeof response === 'object' && 'result' in response ? response.result : response;
}

async function assertMeasurementEnvironment(addresses: string[]) {
  const accounts: string[] = await web3.eth.getAccounts();

  const accountSet = new Set(accounts.map((a: string) => a.toLowerCase()));

  const unknown = addresses.filter((address: string) => !accountSet.has(address.toLowerCase()));

  if (unknown.length > 0) {
    throw new Error(
      [
        'GANACHE IS NOT USING THE EXPECTED MNEMONIC: ' +
          unknown.length +
          '/' +
          addresses.length +
          ' dataset wallets are not Ganache accounts.',
        'First mismatching wallet: ' + unknown[0],
        'The dataset was generated from the mnemonic "test test ... junk",' +
          " path m/44'/60'/0'/0/{index} - see" +
          ' prepareExperimentInputs.ts in Mode B.',
        'Continuing would measure the WRONG system: dataset wallets become fresh wallets (balance 0),' +
          ' every withdraw pays an extra 25 000 gas EIP-161 account-creation fee,' +
          ' so `withdraw_gas` is NOT comparable with ADV/ONC.',
        'Fix - run as ONE LINE (PowerShell):',
        '  ganache --port 8546 --wallet.totalAccounts 501' +
          ' --wallet.mnemonic "test test test test test test test' +
          ' test test test test junk"',
      ].join('\n'),
    );
  }
}

async function deployContract(artifact: any, args: any[], from: string, value: string = '0') {
  const contract: any = new web3.eth.Contract(artifact.abi);

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
      gas: Number(estimatedGas) + 1000000,
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

async function measureVerify(
  verifier: any,
  verifierAddress: string,
  pA: any,
  pB: any,
  pC: any,
  pubSignals: any,
  from: string,
  studentIndex: number,
) {
  const call = verifier.methods.verifyProof(pA, pB, pC, pubSignals);

  const t0 = performance.now();

  const result = await call.call({
    from,
  });

  const verifyOnchainMs = performance.now() - t0;

  if (result !== true) {
    throw new Error(
      `verifyProof returned ${result} at student_index=${studentIndex}. ` +
        `Invalid proof - STOP, do not record this number in the results.`,
    );
  }

  const data = call.encodeABI();

  const estimatedGas = await web3.eth.estimateGas({
    from,
    to: verifierAddress,
    data,
  });

  const receipt = await web3.eth.sendTransaction({
    from,
    to: verifierAddress,
    data,
    gas: Number(estimatedGas) + 100000,
  });

  return {
    verifyOnchainMs,
    verifyGas: Number(receipt.gasUsed),
  };
}

async function main() {
  for (const p of [VERIFIER_ARTIFACT_PATH, POOL_ARTIFACT_PATH]) {
    if (!fs.existsSync(p)) {
      throw new Error(`Missing ${p}\n` + `Generate the verifier and compile the contracts first - see README.md.`);
    }
  }

  const VERIFIER_ARTIFACT = require(VERIFIER_ARTIFACT_PATH);

  const POOL_ARTIFACT = require(POOL_ARTIFACT_PATH);

  fs.mkdirSync(RESULT_DIR, {
    recursive: true,
  });

  const accounts = await web3.eth.getAccounts();

  if (accounts.length === 0) {
    throw new Error(`No accounts on ${RPC_URL}. Is Ganache running?`);
  }

  const school = accounts[0]!;

  const csvPath = path.resolve(RESULT_DIR, 'gas_groth16_raw.csv');

  let csv = CSV_HEADER;

  const summary: any[] = [];

  const scenarios = selectScenarios();

  const allAddresses: string[] = [];

  for (const n of scenarios) {
    const f = proofPathFor(n);

    if (!fs.existsSync(f)) {
      throw new Error(`Missing ${f} - run the proof generation step first.`);
    }

    for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (p.address && allAddresses.indexOf(p.address) === -1) {
        allAddresses.push(p.address);
      }
    }
  }

  await assertMeasurementEnvironment(allAddresses);

  console.error(`K14 passed: ${allAddresses.length}/${allAddresses.length} dataset wallets are Ganache accounts.`);

  for (const n of scenarios) {
    const snapshot = await rawRpc('evm_snapshot');

    if (!snapshot) {
      throw new Error(
        'Ganache returned no snapshot id before n = ' +
          n +
          '. Cannot reset between scenarios => withdraw_gas' +
          ' would depend on the run order. Stopping instead of producing wrong numbers.',
      );
    }

    const proofPath = proofPathFor(n);

    const proofs = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

    if (proofs.length === 0) {
      throw new Error(`proofs_groth16_n${n}.json is empty.`);
    }

    const parsed = proofs.map((p: any) => splitCalldata(p.calldata));

    const scenarioRoot = toBytes32(parsed[0].pubSignals[0]);

    const totalAmount = parsed.reduce((sum: bigint, d: any) => sum + BigInt(d.pubSignals[2]), BigInt(0));

    const poolValue = (totalAmount + totalAmount / BigInt(n)).toString();

    const verifierDeploy = await deployContract(VERIFIER_ARTIFACT, [], school);

    console.error(`n=${n} verifier=${verifierDeploy.address} deployGas=${verifierDeploy.gasUsed}`);

    const denomination = BigInt(parsed[0].pubSignals[2]).toString();

    const poolDeploy = await deployContract(POOL_ARTIFACT, [verifierDeploy.address, denomination], school, poolValue);

    const pool = poolDeploy.instance;

    const poolWDeploy = await deployContract(POOL_ARTIFACT, [verifierDeploy.address, denomination], school, poolValue);

    const poolW = poolWDeploy.instance;

    console.error(
      `n=${n} pool=${poolDeploy.address} poolW=${poolWDeploy.address}` + ` deployGas=${poolDeploy.gasUsed}`,
    );

    const published = await loadCommitments(n);

    const recomputedRoot = toBytes32(published.root.toString());

    if (recomputedRoot !== scenarioRoot) {
      throw new Error(
        [
          `K19 FAILED at n = ${n}: the root recomputed from the commitments` + ' does NOT match the root in the proof.',
          `  recomputed : ${recomputedRoot}`,
          `  in proof   : ${scenarioRoot}`,
          'This means `createCommitment` and the input generation step use' +
            ' two different conventions (argument order, or depth).',
          'Stopping instead of publishing a meaningless commitment array and' + ' recording its gas.',
        ].join('\n'),
      );
    }

    const updateRootTx = await pool.methods.updateRoot(scenarioRoot, published.values).send({
      from: school,
      gas: 30000000,
    });

    const updateRootGas = Number(updateRootTx.gasUsed);

    await poolW.methods.updateRoot(scenarioRoot, published.values).send({
      from: school,
      gas: 30000000,
    });

    for (let i = 0; i < proofs.length; i++) {
      const proofData = proofs[i];

      const { pA, pB, pC, pubSignals } = parsed[i];

      const root = toBytes32(pubSignals[0]);

      const nullifier = toBytes32(pubSignals[1]);

      const amountWei = BigInt(pubSignals[2]).toString();

      const recipient = proofData.address || accounts[2];

      const verifyResult = await measureVerify(
        verifierDeploy.instance,
        verifierDeploy.address,
        pA,
        pB,
        pC,
        pubSignals,
        school,
        proofData.student_index,
      );

      const withdrawCall = poolW.methods.withdraw(pA, pB, pC, pubSignals, root, nullifier, recipient, amountWei);

      const withdrawStart = performance.now();

      const withdrawTx = await withdrawCall.send({
        from: school,
        gas: 2000000,
      });

      const withdrawMs = performance.now() - withdrawStart;

      const verifyRecordCall = pool.methods.verifyAndRecord(
        pA,
        pB,
        pC,
        pubSignals,
        root,
        nullifier,
        recipient,
        amountWei,
      );

      const verifyRecordStart = performance.now();

      const verifyRecordTx = await verifyRecordCall.send({
        from: school,
        gas: 2000000,
      });

      const verifyRecordMs = performance.now() - verifyRecordStart;

      const settleStart = performance.now();

      const settleTx = await pool.methods.settle(nullifier).send({
        from: school,
        gas: 2000000,
      });

      const settleMs = performance.now() - settleStart;

      console.error(
        `  n=${n} idx=${proofData.student_index} ` +
          `verifyGas=${verifyResult.verifyGas} ` +
          `withdrawGas=${Number(withdrawTx.gasUsed)} ` +
          `verifyRecordGas=${Number(verifyRecordTx.gasUsed)} ` +
          `settleGas=${Number(settleTx.gasUsed)}`,
      );

      csv +=
        [
          'groth16',
          n,
          proofData.student_index,
          poolDeploy.gasUsed,
          verifierDeploy.gasUsed,
          updateRootGas,
          verifyResult.verifyGas,
          verifyResult.verifyOnchainMs.toFixed(6),
          Number(withdrawTx.gasUsed),
          withdrawMs.toFixed(6),
          Number(verifyRecordTx.gasUsed),
          verifyRecordMs.toFixed(6),
          Number(settleTx.gasUsed),
          settleMs.toFixed(6),
          root,
          nullifier,
        ].join(',') + '\n';
    }

    fs.writeFileSync(csvPath, csv);

    const scenarioRows = csv
      .trim()
      .split('\n')
      .slice(1)
      .filter((row: string) => row.split(',')[1] === String(n));

    const csvPathForN = path.resolve(RESULT_DIR, `gas_groth16_n${n}.csv`);

    fs.writeFileSync(csvPathForN, CSV_HEADER + scenarioRows.join('\n') + '\n');

    console.error(`Wrote n=${n} -> gas_groth16_raw.csv and` + ` gas_groth16_n${n}.csv (${scenarioRows.length} rows)`);

    const reverted = await rawRpc('evm_revert', [snapshot]);

    if (reverted !== true) {
      throw new Error(
        'evm_revert returned ' +
          JSON.stringify(reverted) +
          ' after n = ' +
          n +
          ' (expected true). The chain was NOT' +
          ' cleaned, so the next scenario would measure wrong numbers. Stopping.',
      );
    }

    console.error(`Reverted the chain to a clean state after n = ${n}`);

    summary.push({
      n,
      proofCount: proofs.length,
      deployVerifierGas: verifierDeploy.gasUsed,
      deployPoolGas: poolDeploy.gasUsed,
      updateRootGas,
    });
  }

  console.log(
    JSON.stringify(
      {
        step: 'benchmarkGas',
        proofSystem: 'groth16 (circom/snarkjs)',
        rpc: RPC_URL,
        scenarios: summary,
        file: path.relative(PROJECT_ROOT, csvPath),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: any) => {
    console.error(error);
    process.exit(1);
  });
