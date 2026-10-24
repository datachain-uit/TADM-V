/// <reference path="../types/snarkjs.d.ts" />
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as snarkjs from 'snarkjs';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const RESULT_DIR = path.resolve(PROJECT_ROOT, process.env.RESULTS_DIR || 'experiments/results/quantitative');

const VERIFIER_SOL = path.resolve(PROJECT_ROOT, 'contracts/contracts/Groth16Verifier.sol');

const VERIFIER_ARTIFACT_PATH = path.resolve(
  PROJECT_ROOT,
  'contracts/artifacts/contracts/Groth16Verifier.sol/Groth16Verifier.json',
);

const POOL_SOL = path.resolve(PROJECT_ROOT, 'contracts/contracts/ShieldedPoolGroth16.sol');

const POOL_ARTIFACT_PATH = path.resolve(
  PROJECT_ROOT,
  'contracts/artifacts/contracts/ShieldedPoolGroth16.sol' + '/ShieldedPoolGroth16.json',
);

const R1CS_PATH = path.resolve(PROJECT_ROOT, 'build/withdraw.r1cs');

const BUILD_INFO_DIR = path.resolve(PROJECT_ROOT, 'contracts/artifacts/build-info');

const GAS_CSV = path.resolve(RESULT_DIR, 'gas_groth16_raw.csv');

const EIP170_LIMIT = 24576;

const BLOCK_GAS_LIMIT = 30000000;

const G_CODEDEPOSIT_PER_BYTE = 200;

const SCENARIOS = [1, 10, 30, 60, 100, 500];

function hexByteLength(hex: string): number {
  if (!hex) {
    return 0;
  }

  const s = hex.startsWith('0x') ? hex.slice(2) : hex;

  return Math.floor(s.length / 2);
}

function readCsv(p: string): Record<string, string>[] {
  const raw = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);

  const headerLine = raw[0];

  if (headerLine === undefined) {
    return [];
  }

  const columns = headerLine.split(',');

  return raw.slice(1).map((line: string) => {
    const o: Record<string, string> = {};
    const v = line.split(',');

    columns.forEach((c: string, i: number) => {
      o[c] = v[i] ?? '';
    });

    return o;
  });
}

function column(rows: Record<string, string>[], name: string): number[] {
  return rows
    .map((r) => r[name])
    .filter((x): x is string => x !== undefined && x.trim() !== '')
    .map(Number)
    .filter((x: number) => Number.isFinite(x));
}

function gasBlock(v: number[]): any {
  if (v.length === 0) {
    return null;
  }

  const mean = v.reduce((a: number, b: number) => a + b, 0) / v.length;

  return {
    mean: Math.round(mean),
    min: Math.min(...v),
    max: Math.max(...v),
    samples: v.length,
    block_gas_percent: Math.round((mean / BLOCK_GAS_LIMIT) * 10000) / 100,
  };
}

function functionSignature(artifactJson: any, name: string): string {
  const abi: any[] = artifactJson.abi ?? [];

  for (const f of abi) {
    if (f.type === 'function' && f.name === name) {
      return name + '(' + (f.inputs ?? []).map((i: any) => i.type).join(',') + ')';
    }
  }

  return '(' + name + ' not found in ABI)';
}

function countArgs(artifactJson: any, name: string): { total_args: number; dynamic_args: number } {
  const abi: any[] = artifactJson.abi ?? [];

  for (const f of abi) {
    if (f.type === 'function' && f.name === name) {
      const inp: any[] = f.inputs ?? [];

      return {
        total_args: inp.length,
        dynamic_args: inp.filter(
          (i: any) => String(i.type).indexOf('[]') !== -1 || i.type === 'bytes' || i.type === 'string',
        ).length,
      };
    }
  }

  return { total_args: 0, dynamic_args: 0 };
}

function soliditySettings(): any {
  if (!fs.existsSync(BUILD_INFO_DIR)) {
    return {
      builds: [],
      note: 'artifacts/build-info not found - not compiled yet?',
    };
  }

  const builds: any[] = [];

  for (const f of fs.readdirSync(BUILD_INFO_DIR)) {
    if (!f.endsWith('.json')) {
      continue;
    }

    const bi = JSON.parse(fs.readFileSync(path.resolve(BUILD_INFO_DIR, f), 'utf8'));

    const st = bi.input?.settings ?? {};

    builds.push({
      solc: bi.solcVersion ?? '?',
      evm_version: st.evmVersion ?? '(solc default)',
      optimizer: st.optimizer?.enabled ? 'on' : 'off',
      optimizer_runs: st.optimizer?.runs ?? 200,
      contracts: Object.keys(bi.input?.sources ?? {}).map((s: string) => path.basename(s)),
    });
  }

  return {
    builds,
    note:
      'Read from artifacts/build-info - the solc settings ACTUALLY used, ' +
      'not copied by hand from hardhat.config.js.',
  };
}

async function main() {
  for (const p of [VERIFIER_SOL, VERIFIER_ARTIFACT_PATH, POOL_SOL, POOL_ARTIFACT_PATH, R1CS_PATH]) {
    if (!fs.existsSync(p)) {
      throw new Error(`Missing ${p} - see README.md.`);
    }
  }

  const artifact = require(VERIFIER_ARTIFACT_PATH);

  const deployedBytes = hexByteLength(artifact.deployedBytecode);

  const creationBytes = hexByteLength(artifact.bytecode);

  const poolArtifact = require(POOL_ARTIFACT_PATH);

  const poolDeployedBytes = hexByteLength(poolArtifact.deployedBytecode);

  const poolCreationBytes = hexByteLength(poolArtifact.bytecode);

  const r1cs = await snarkjs.r1cs.info(R1CS_PATH);

  const merkleDepth = r1cs.nPrvInputs >= 2 ? (r1cs.nPrvInputs - 2) / 2 : 0;

  const perScenario: any = {};

  for (const n of SCENARIOS) {
    const proofPath = path.resolve(RESULT_DIR, `proofs_groth16_n${n}.json`);

    if (!fs.existsSync(proofPath)) {
      continue;
    }

    const proofs = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

    const sizes = proofs.map((p: any) => Buffer.from(JSON.stringify(p.proof)).length);

    perScenario[`n${n}`] = {
      records: proofs.length,
      proof_json_bytes_min: Math.min(...sizes),
      proof_json_bytes_max: Math.max(...sizes),
    };
  }

  const gasRows = fs.existsSync(GAS_CSV) ? readCsv(GAS_CSV) : [];

  const gWithdraw = gasBlock(column(gasRows, 'withdraw_gas'));
  const gVerifyRec = gasBlock(column(gasRows, 'verify_record_gas'));
  const gSettle = gasBlock(column(gasRows, 'settle_gas'));
  const gPool = gasBlock(column(gasRows, 'deploy_pool_gas'));
  const gVerifier = gasBlock(column(gasRows, 'deploy_verifier_gas'));

  const calldataBytes: number[] = [];

  for (const n of SCENARIOS) {
    const perfPath = path.resolve(RESULT_DIR, `performance_groth16_n${n}.csv`);

    if (!fs.existsSync(perfPath)) {
      continue;
    }

    for (const v of column(readCsv(perfPath), 'calldata_bytes')) {
      calldataBytes.push(v);
    }
  }

  const systemTotal = (gPool ? gPool.mean : 0) + (gVerifier ? gVerifier.mean : 0);

  const out = {
    metadata: {
      measured_at: new Date().toISOString(),
      git_commit: null,
      git_commit_note: 'Not recorded by the script. Reproduce by re-running the pipeline in README.md.',
      machine: {
        cpu: os.cpus()[0] ? os.cpus()[0]!.model : 'unknown',
        cpu_cores: os.cpus().length,
        total_ram_gb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
        platform: `${os.platform()} ${os.release()}`,
        node: process.version,
      },
      proof_system: {
        mechanism: 'baseline-groth16',
        library: 'circom 2.x + snarkjs (groth16)',
        curve: r1cs.curve?.name ?? 'bn128',
        commitment_scheme: 'Groth16 (pairing-based)',
        k: null,
        k_note:
          'Groth16 uses R1CS and has no `k` parameter like PLONKish. ' +
          'The closest equivalent quantity is the number of constraints.',
        constraints: r1cs.nConstraints,
        private_inputs: r1cs.nPrvInputs,
        public_inputs_count: r1cs.nPubInputs,
        merkle_depth: merkleDepth,
        max_leaves_per_pool: Math.pow(2, merkleDepth),
        merkle_depth_source:
          'DERIVED from nPrvInputs = 2 + 2*depth ' +
          '(student_id, rho, siblings[depth], directions[depth]) ' +
          '- read from build/withdraw.r1cs, NOT hard-coded.',
        public_inputs: ['root', 'nullifier', 'amount', 'recipient'],
        trusted_setup:
          'Public Powers of Tau + a phase 2 specific to THIS CIRCUIT. ' +
          'Groth16 requires a SEPARATE ceremony for EACH circuit - this is the main ' +
          "trade-off axis against the paper's two branches. Fixed entropy " +
          '"baseline-groth16-2026" for reproducibility => sufficient for the ' +
          'experiment, NOT sufficient to claim soundness.',
      },
      solidity: soliditySettings(),
      chain: {
        rpc: 'Ganache ' + (process.env.RPC_URL ?? 'http://127.0.0.1:8546'),
        startup_command:
          'ganache --wallet.mnemonic "test test test test test ' +
          'test test test test test test junk" ' +
          '--wallet.totalAccounts 501',
        port_note:
          'The baseline defaults to 8546 so it does NOT collide with ADV/ONC ' +
          '(both use 8545 and account[0]). The reported run of ' +
          "2026-09-07 ran on 8545 - the user's only Ganache - " +
          'via the RPC_URL environment variable, WITHOUT changing code. ' +
          'Valid because no other branch was running at the time; the ' +
          '"no two branches at once" rule of CLAUDE.md is extended ' +
          'to all three.',
        hardfork: 'Ganache default - must match evm_version above',
        opcodes_used_by_this_system:
          'SLOAD, SSTORE, CALL, STATICCALL, memory, calldata - their ' +
          'prices last changed in Berlin/London, ALL BEFORE ' +
          '`paris`. Shanghai and Cancun only ADD opcodes, they do not ' +
          'reprice old ones => these gas figures still hold on ' +
          'current mainnet.',
        gas_is_a_counted_quantity:
          'Gas is fixed by the EVM SPECIFICATION, NOT by the client machine => it ' +
          'carries over to mainnet as long as the hardfork matches. Wall-clock ' +
          'time does NOT carry over.',
      },
    },

    verifier_contract: {
      source_bytes: fs.statSync(VERIFIER_SOL).size,
      deployed_bytecode_bytes: deployedBytes,
      creation_bytecode_bytes: creationBytes,
      eip170_limit_bytes: EIP170_LIMIT,
      eip170_usage_percent: Math.round((deployedBytes / EIP170_LIMIT) * 1000) / 10,
    },

    pool_contract: {
      source_bytes: fs.statSync(POOL_SOL).size,
      deployed_bytecode_bytes: poolDeployedBytes,
      creation_bytecode_bytes: poolCreationBytes,
      eip170_limit_bytes: EIP170_LIMIT,
      eip170_usage_percent: Math.round((poolDeployedBytes / EIP170_LIMIT) * 1000) / 10,
      note: 'EIP-170 limits EACH contract separately. Do NOT add these two numbers ' + 'and compare with 24 576.',
    },

    withdraw_calldata: {
      function_signature: functionSignature(poolArtifact, 'withdraw'),
      verify_record_signature: functionSignature(poolArtifact, 'verifyAndRecord'),
      settle_signature: functionSignature(poolArtifact, 'settle'),
      selector_bytes: 4,
      total_args: countArgs(poolArtifact, 'withdraw').total_args,
      dynamic_args: countArgs(poolArtifact, 'withdraw').dynamic_args,
      calldata_bytes:
        calldataBytes.length > 0 && Math.min(...calldataBytes) === Math.max(...calldataBytes)
          ? Math.min(...calldataBytes)
          : null,
      proof_blob_bytes: null,
      proof_blob_padded_bytes: null,
      proof_blob_note:
        'Not applicable: the snarkjs verifier takes four typed arrays ' +
        '(uint[2], uint[2][2], uint[2], uint[4]), not a `bytes` ' +
        'blob like ONC. This interface difference is what explains the ' +
        '22 gas offset in check K1.',
      calldata_bytes_min: calldataBytes.length > 0 ? Math.min(...calldataBytes) : null,
      calldata_bytes_max: calldataBytes.length > 0 ? Math.max(...calldataBytes) : null,
      note:
        'Signature DIFFERS from ONC: the snarkjs-generated verifier takes FOUR TYPED arrays, ' +
        'ONC takes one `bytes` blob. This is an INTERFACE difference, not a ' +
        'proof-system difference - it explains why the selector ' +
        'and dispatch position differ, which shifts update_root_gas by ~22 ' +
        'gas relative to ONC.',
    },

    block_gas: {
      block_gas_limit: BLOCK_GAS_LIMIT,
      withdraw: gWithdraw,
      verify_record: gVerifyRec,
      settle: gSettle,
      deploy_pool: gPool,
      deploy_verifier: gVerifier,
      whole_system: {
        total_gas: systemTotal,
        block_gas_percent: Math.round((systemTotal / BLOCK_GAS_LIMIT) * 10000) / 100,
        consists_of: 'deploy_verifier_gas + deploy_pool_gas',
        second_pool_onward: gPool ? gPool.mean : null,
        second_pool_note: 'if the verifier is reused - one verifier serves many pools',
      },
      note:
        'block_gas_limit is an ASSUMPTION about mainnet (30M), NOT a ' +
        'measurement. Only the gas figures are real measurements on Ganache. `withdraw` ' +
        'is the RECURRING cost per transaction; `whole_system` is the ' +
        'ONE-TIME cost - two different questions, do not combine them.',
    },

    bytecode_vs_deploy_gas: {
      g_codedeposit_per_byte: G_CODEDEPOSIT_PER_BYTE,
      g_codedeposit_source: 'Yellow Paper - an EVM constant, NOT a measurement',
      verifier:
        gVerifier && deployedBytes > 0
          ? {
              deployed_bytecode_bytes: deployedBytes,
              code_deposit_gas: deployedBytes * G_CODEDEPOSIT_PER_BYTE,
              deploy_gas_measured: gVerifier.mean,
              remainder: gVerifier.mean - deployedBytes * G_CODEDEPOSIT_PER_BYTE,
              gas_per_byte_measured: Math.round((gVerifier.mean / deployedBytes) * 100) / 100,
            }
          : null,
      pool:
        gPool && poolDeployedBytes > 0
          ? {
              deployed_bytecode_bytes: poolDeployedBytes,
              code_deposit_gas: poolDeployedBytes * G_CODEDEPOSIT_PER_BYTE,
              deploy_gas_measured: gPool.mean,
              remainder: gPool.mean - poolDeployedBytes * G_CODEDEPOSIT_PER_BYTE,
              gas_per_byte_measured: Math.round((gPool.mean / poolDeployedBytes) * 100) / 100,
            }
          : null,
      measured_slope_gas_per_byte:
        gVerifier && deployedBytes > 0 ? Math.round((gVerifier.mean / deployedBytes) * 100) / 100 : null,
      remainder_consists_of:
        '21 000 transaction fee + 32 000 contract creation fee + init code ' +
        'sent as calldata + constructor execution',
      slope_explanation:
        '200 (code stored on chain) + the remainder: the init code ALSO has to be sent ' +
        'with the transaction as calldata => paying TWICE for ' +
        'almost the same bytes, plus the 21 000 transaction fee + 32 000 ' +
        'contract creation fee + constructor execution.',
    },

    proof_calldata: {
      note:
        'The real calldata byte count is in the calldata_bytes column of ' +
        'gas_groth16_raw.csv. The numbers below are the JSON size of the ' +
        'proof, NOT calldata - do not confuse the two.',
      per_scenario: perScenario,
    },
  };

  fs.mkdirSync(RESULT_DIR, {
    recursive: true,
  });

  const outPath = path.resolve(RESULT_DIR, 'artifact_sizes_groth16.json');

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.error('Wrote ' + outPath);

  console.log(
    JSON.stringify(
      {
        merkle_depth: merkleDepth,
        constraints: r1cs.nConstraints,
        private_inputs: r1cs.nPrvInputs,
        verifier_deployed_bytes: deployedBytes,
        verifier_eip170_percent: out.verifier_contract.eip170_usage_percent,
        pool_deployed_bytes: poolDeployedBytes,
        withdraw_block_percent: gWithdraw ? gWithdraw.block_gas_percent : null,
        file: outPath,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e: any) => {
    console.error(e);
    process.exit(1);
  });
