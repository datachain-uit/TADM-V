import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RESULTS_DIR = path.join(REPO_ROOT, 'experiments', 'results', 'quantitative');

const EIP170_LIMIT = 24576;

const BLOCK_GAS_LIMIT = 30_000_000;

function safeExec(command: string): string {
  try {
    return execSync(command, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (error) {
    return 'unknown';
  }
}

function buildMetadata() {
  const cpus = os.cpus();

  return {
    measured_at: new Date().toISOString(),
    git_commit: safeExec('git rev-parse --short HEAD'),
    machine: {
      cpu: cpus.length > 0 ? cpus[0]!.model.trim() : 'unknown',
      cpu_cores: cpus.length,
      total_ram_gb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
    },
    proof_system: {
      mechanism: 'offchain',
      library: 'halo2_proofs 0.3.2 (zcash)',
      curve: 'Pasta (Pallas/Vesta)',
      commitment_scheme: 'IPA',
      k: 9,
      merkle_depth: 9,
      max_leaves_per_pool: 512,
      public_inputs: ['root', 'nullifier', 'amount'],
      trusted_setup:
        'IPA - NO trusted setup required. This is a fundamental difference ' +
        'from the on-chain branch (KZG needs an SRS) and from Groth16 ' +
        '(needs a per-circuit ceremony).',
    },
    solidity: readCompilerSettings(),

    chain: {
      rpc: 'Ganache 127.0.0.1:8545',
      startup_command:
        'ganache --wallet.mnemonic "test test test test test ' +
        'test test test test test test junk" ' +
        '--wallet.totalAccounts 501',
      hardfork: 'Ganache default - must match the evmVersion above',
      gas_is_a_counted_quantity:
        'Gas is fixed by the EVM specification, NOT by the client ' +
        '=> it carries over to mainnet as long as the hardfork ' +
        'matches. Wall-clock time does NOT carry over.',
      opcodes_used_by_this_system:
        'SLOAD, SSTORE, CALL, STATICCALL, memory, calldata - their ' +
        'prices last changed at Berlin/London, both BEFORE paris. ' +
        'Shanghai and Cancun only ADD opcodes; they do not reprice ' +
        "existing ones => these gas figures still hold on today's " +
        'mainnet.',
    },
  };
}

function readCompilerSettings() {
  const dir = path.join(REPO_ROOT, 'contracts', 'artifacts', 'build-info');

  if (!fs.existsSync(dir)) {
    return { note: 'Not compiled yet - compiler settings unavailable' };
  }

  const result: any[] = [];

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) {
      continue;
    }

    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const s = (j.input && j.input.settings) || {};

    result.push({
      solc: j.solcVersion,
      evm_version: s.evmVersion || '(NOT PINNED - solc default)',
      optimizer: s.optimizer && s.optimizer.enabled ? 'on' : 'off',
      optimizer_runs: s.optimizer && s.optimizer.runs ? s.optimizer.runs : null,
      contracts: Object.keys((j.input && j.input.sources) || {}).map((x: string) => x.split('/').pop()),
    });
  }

  return {
    builds: result,
    note: 'Read from artifacts/build-info - the settings solc ACTUALLY used, ' + 'not copied from hardhat.config.js.',
  };
}

function contractSizes(contractFile: string, contractName: string) {
  const source = path.join(REPO_ROOT, 'contracts', 'contracts', contractFile);

  const artifact = path.join(REPO_ROOT, 'contracts', 'artifacts', 'contracts', contractFile, `${contractName}.json`);

  const result: any = {
    source_bytes: fs.existsSync(source) ? fs.statSync(source).size : null,
  };

  if (!fs.existsSync(artifact)) {
    result.note = 'Not compiled - run `npx hardhat compile` in contracts/ first';
    return result;
  }

  const compiled = JSON.parse(fs.readFileSync(artifact, 'utf8'));

  result.deployed_bytecode_bytes = Math.floor((String(compiled.deployedBytecode).length - 2) / 2);

  result.creation_bytecode_bytes = Math.floor((String(compiled.bytecode).length - 2) / 2);

  result.eip170_limit_bytes = EIP170_LIMIT;
  result.eip170_usage_percent = Math.round((result.deployed_bytecode_bytes / EIP170_LIMIT) * 1000) / 10;

  return result;
}

function withdrawCalldataBytes() {
  const artifact = path.join(REPO_ROOT, 'contracts', 'artifacts', 'contracts', 'ShieldedPool.sol', 'ShieldedPool.json');

  if (!fs.existsSync(artifact)) {
    return { note: 'ShieldedPool not compiled' };
  }

  const compiled = JSON.parse(fs.readFileSync(artifact, 'utf8'));

  const fn = (compiled.abi || []).find((item: any) => item.type === 'function' && item.name === 'withdrawOffChain');

  if (!fn) {
    return { note: 'withdrawOffChain not found in ABI' };
  }

  const lines = (fn.inputs || []).filter((i: any) => i.type === 'bytes' || i.type === 'string');

  const bytes = 4 + (fn.inputs || []).length * 32;

  return {
    function_signature: `${fn.name}(${(fn.inputs || []).map((i: any) => i.type).join(',')})`,
    selector_bytes: 4,
    static_args: (fn.inputs || []).length,
    dynamic_args: lines.length,
    calldata_bytes: bytes,
    note:
      'D7 definition: 4-byte selector + all ABI-encoded arguments. ' +
      'ADV sends no proof on chain, hence NO dynamic argument - which ' +
      'is simultaneously the gain (tiny calldata) and the loss (the ' +
      'contract cannot verify anything; it trusts the university).',
  };
}

function readColumn(file: string, name: string): number[] {
  if (!fs.existsSync(file)) {
    return [];
  }

  const lines = String(fs.readFileSync(file, 'utf8'))
    .split('\n')
    .filter((l: string) => l.trim().length > 0);

  if (lines.length < 2) {
    return [];
  }

  const columnIndex = String(lines[0]).split(',').indexOf(name);

  if (columnIndex < 0) {
    return [];
  }

  const values: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = String(lines[i]).split(',')[columnIndex];
    const v = Number(cells);
    if (cells !== undefined && cells !== '' && Number.isFinite(v) && v > 0) {
      values.push(v);
    }
  }

  return values;
}

function stats(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    mean: Math.round(mean),
    min: Math.min(...values),
    max: Math.max(...values),
    samples: values.length,
    block_gas_percent: Math.round((mean / BLOCK_GAS_LIMIT) * 10000) / 100,
  };
}

function blockGasShare() {
  const file = path.join(RESULTS_DIR, 'gas_offchain_raw.csv');

  if (!fs.existsSync(file)) {
    return {
      block_gas_limit: BLOCK_GAS_LIMIT,
      note: 'gas_offchain_raw.csv missing - run experiment:quantitative first',
    };
  }

  const withdraw = stats(readColumn(file, 'withdraw_gas'));
  const deployPool = stats(readColumn(file, 'deploy_pool_gas'));

  const wholeSystem =
    deployPool === null
      ? null
      : {
          total_gas: deployPool.mean,
          block_gas_percent: deployPool.block_gas_percent,
          consists_of: 'deploy_pool_gas (ADV has no verifier to deploy)',
        };

  return {
    block_gas_limit: BLOCK_GAS_LIMIT,

    withdraw: withdraw,
    deploy_pool: deployPool,
    deploy_verifier: null,
    whole_system: wholeSystem,

    note:
      'block_gas_limit is an ASSUMPTION about mainnet (30M), not a ' +
      'measurement. The gas figures are real measurements on Ganache. ' +
      '`withdraw` is a RECURRING per-transaction cost; `whole_system` ' +
      'is a ONE-TIME cost - two different questions.',
  };
}

function bytecodeVsDeployGas(poolBytes: number | null, poolGas: number | null) {
  if (poolBytes === null || poolGas === null) {
    return { note: 'Missing bytecode or deploy gas - cannot compute' };
  }

  const codeDeposit = poolBytes * 200;

  return {
    g_codedeposit_per_byte: 200,
    g_codedeposit_source: 'Ethereum Yellow Paper - an EVM constant, not a measurement',
    pool: {
      deployed_bytecode_bytes: poolBytes,
      code_deposit_gas: codeDeposit,
      deploy_gas_measured: poolGas,
      remainder: poolGas - codeDeposit,
      remainder_consists_of:
        '21 000 base transaction + 32 000 contract creation ' +
        '+ calldata for the creation bytecode (~13-16 gas/byte) ' +
        '+ constructor execution',
    },
    note:
      'Bytecode size and deploy gas are TWO VIEWS of one thing: bytes ' +
      "answer 'is it allowed on chain at all' (EIP-170), gas answers " +
      "'how much does it cost'.",
  };
}

function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const poolSizes: any = contractSizes('ShieldedPool.sol', 'ShieldedPool');
  const blockGas: any = blockGasShare();

  const output = {
    metadata: buildMetadata(),

    verifier_contract: {
      exists: false,
      deployed_bytecode_bytes: null,
      eip170_limit_bytes: EIP170_LIMIT,
      eip170_usage_percent: null,
      note:
        'MECHANISM DOES NOT EXIST - the off-chain branch has no verifier ' +
        'contract. This cell must stay EMPTY in the paper, never 0 ' +
        "(0 reads as 'free to deploy' and hides the real price: the " +
        'contract cannot verify the proof itself).',
    },

    pool_contract: poolSizes,

    withdraw_calldata: withdrawCalldataBytes(),

    block_gas: blockGas,

    bytecode_vs_deploy_gas: bytecodeVsDeployGas(
      typeof poolSizes.deployed_bytecode_bytes === 'number' ? poolSizes.deployed_bytecode_bytes : null,
      blockGas.deploy_pool ? blockGas.deploy_pool.mean : null,
    ),
  };

  const target = path.join(RESULTS_DIR, 'artifact_sizes.json');

  fs.writeFileSync(target, JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
  console.error(`\nWrote: ${target}`);
}

main();
