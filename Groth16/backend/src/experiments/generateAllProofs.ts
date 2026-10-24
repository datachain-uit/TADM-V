/// <reference path="../types/snarkjs.d.ts" />
import fs from 'fs';
import path from 'path';
import * as snarkjs from 'snarkjs';
import { performance } from 'perf_hooks';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const INPUT_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');

const RESULT_DIR = path.resolve(PROJECT_ROOT, process.env.RESULTS_DIR || 'experiments/results/quantitative');

const BUILD_DIR = path.resolve(PROJECT_ROOT, 'build');

const WASM_PATH = path.resolve(BUILD_DIR, 'withdraw_js/withdraw.wasm');

const ZKEY_PATH = path.resolve(BUILD_DIR, 'withdraw_final.zkey');

const VKEY_PATH = path.resolve(BUILD_DIR, 'verification_key.json');

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

function countCalldataBytes(calldata: string): number {
  const hex = calldata.match(/0x[0-9a-fA-F]+/g) || [];

  return hex.reduce((total: number, h: string) => total + (h.length - 2) / 2, 0);
}

async function main() {
  for (const p of [WASM_PATH, ZKEY_PATH, VKEY_PATH]) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `Missing ${p}\n` + `Run the circuit compilation and trusted setup steps first` + ` - see README.md.`,
      );
    }
  }

  fs.mkdirSync(RESULT_DIR, {
    recursive: true,
  });

  const setupStart = performance.now();

  const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));

  const zkeyBuffer = new Uint8Array(fs.readFileSync(ZKEY_PATH));

  const setupMs = performance.now() - setupStart;

  const summary: any[] = [];

  for (const n of selectScenarios()) {
    const inputFile = path.resolve(INPUT_DIR, `inputs_n${n}.json`);

    if (!fs.existsSync(inputFile)) {
      throw new Error(`Missing ${inputFile} - run the prepareInputs step first.`);
    }

    const bundle = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

    const previousProofPath = path.resolve(RESULT_DIR, `proofs_groth16_n${n}.json`);

    const previousProofIsFresh =
      fs.existsSync(previousProofPath) &&
      fs.statSync(previousProofPath).mtimeMs > fs.statSync(ZKEY_PATH).mtimeMs &&
      fs.statSync(previousProofPath).mtimeMs > fs.statSync(inputFile).mtimeMs;

    if (fs.existsSync(previousProofPath) && !previousProofIsFresh) {
      console.error(`  n=${n}: existing proof file is STALE (older than zkey or input)` + ` - regenerating.`);
    }

    if (previousProofIsFresh && process.env.FORCE_RERUN !== '1') {
      console.error(
        [
          '',
          '  ################################################',
          `  # SKIPPING n = ${n} - proof file exists from a previous run`,
          `  #   ${path.relative(PROJECT_ROOT, previousProofPath)}`,
          '  #',
          '  # NO proof is regenerated for this scenario.',
          '  # Changed circuit / d / ceremony => the old file is STALE,',
          '  # delete it or set FORCE_RERUN=1.',
          '  ################################################',
          '',
        ].join('\n'),
      );

      summary.push({
        n,
        skipped: true,
        reason: 'proof file already exists; set FORCE_RERUN=1 to regenerate',
      });

      continue;
    }

    const proofs: any[] = [];

    let csv =
      'mechanism,n,student_index,' +
      'witness_ms,setup_ms,prove_ms,proof_generation_ms,' +
      'verify_native_ms,verified,' +
      'proof_bytes,calldata_bytes,' +
      'root,nullifier\n';

    for (const entry of bundle.inputs) {
      const witnessStart = performance.now();

      const wtnsBuffer = { type: 'mem' } as any;

      await snarkjs.wtns.calculate(entry.input, WASM_PATH, wtnsBuffer);

      const witnessMs = performance.now() - witnessStart;

      const proveStart = performance.now();

      const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyBuffer, wtnsBuffer);

      const proveMs = performance.now() - proveStart;

      const verifyStart = performance.now();

      const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);

      const verifyNativeMs = performance.now() - verifyStart;

      if (verified !== true) {
        throw new Error(
          `groth16.verify returned ${verified} at student_index=` +
            `${entry.student_index}, n=${n}. Invalid proof -` +
            ` STOP, do not record this number in the results.`,
        );
      }

      const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);

      const proofBytes = Buffer.from(JSON.stringify(proof)).length;

      const calldataBytes = countCalldataBytes(calldata);

      const root = publicSignals[0];

      const nullifier = publicSignals[1];

      proofs.push({
        student_index: entry.student_index,
        address: entry.address,
        proof,
        publicSignals,
        calldata,
      });

      csv +=
        [
          'groth16',
          n,
          entry.student_index,
          witnessMs.toFixed(6),
          setupMs.toFixed(6),
          proveMs.toFixed(6),
          (witnessMs + proveMs).toFixed(6),
          verifyNativeMs.toFixed(6),
          'true',
          proofBytes,
          calldataBytes,
          root,
          nullifier,
        ].join(',') + '\n';
    }

    const proofPath = path.resolve(RESULT_DIR, `proofs_groth16_n${n}.json`);

    fs.writeFileSync(proofPath, JSON.stringify(proofs, null, 2));

    const csvPath = path.resolve(RESULT_DIR, `performance_groth16_n${n}.csv`);

    fs.writeFileSync(csvPath, csv);

    console.error(`n=${n}: ${proofs.length} proofs, all verified natively`);

    summary.push({
      n,
      proofCount: proofs.length,
      proofFile: path.relative(PROJECT_ROOT, proofPath),
      csvFile: path.relative(PROJECT_ROOT, csvPath),
    });
  }

  console.log(
    JSON.stringify(
      {
        step: 'generateAllProofs',
        proofSystem: 'groth16 (circom/snarkjs)',
        setup_ms: Number(setupMs.toFixed(6)),
        note:
          'setup_ms is measured ONCE (loading zkey + vkey) and repeated on every' +
          ' CSV row for convenience. It is NOT added to proof_generation_ms.',
        scenarios: summary,
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
