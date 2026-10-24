require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Web3 } from 'web3';
import { performance } from 'perf_hooks';
import { runProver, proverBinary } from '../clients/prover/halo2ProverClient';
import {
  runScenario,
  assertMeasurementEnvironment,
  callRpc,
  readDataset,
  CSV_GAS_HEADER,
  PERFORMANCE_CSV_HEADER,
} from './quantitativeExperiment';

const MECHANISM = 'offchain';

const web3 = new Web3('http://127.0.0.1:8545');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const MODE = (process.env.PROVER_MODE || 'cold').trim();

if (MODE !== 'cold' && MODE !== 'warm') {
  throw new Error(`PROVER_MODE is invalid: "${MODE}" (expected "cold" or "warm")`);
}

const WARM_MODE = MODE === 'warm';

const RESULTS_ROOT = path.resolve(
  PROJECT_ROOT,
  process.env.RUNS_DIR ||
    (WARM_MODE
      ? 'experiments/results/quantitative/repeated_runs_warm'
      : 'experiments/results/quantitative/repeated_runs'),
);

const DEFAULT_DEPTH = 9;
const DEFAULT_K = 9;

const K_PROBE_MIN = 4;
const K_PROBE_MAX = 16;

const SOURCE_N = 500;

type Experiment = 'by_n' | 'by_depth';

type Config = {
  experiment: Experiment;
  name: string;
  n: number;
  d: number;
};

type MeasuredRow = {
  warmup: boolean;
  iteration: number;
  row: string;
};

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const x = Number(raw.trim());

  if (!Number.isInteger(x) || x < min || x > max) {
    throw new Error(`${name} is invalid: "${raw}" (expected an integer ${min}..${max})`);
  }

  return x;
}

function readList(name: string, fallback: number[], isValid: (x: number) => boolean): number[] {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const values = raw.split(',').map((s: string) => Number(s.trim()));

  const bad = values.filter((x: number) => !Number.isInteger(x) || !isValid(x));

  if (values.length === 0 || bad.length > 0) {
    throw new Error(`${name} is invalid: "${raw}"`);
  }

  return Array.from(new Set(values));
}

function readRuns(runCount: number): number[] {
  const all = Array.from({ length: runCount }, (_: unknown, i: number) => i + 1);

  const raw = process.env.ONLY_RUNS;

  if (!raw || !raw.trim()) {
    return all;
  }

  const chosen = new Set<number>();

  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);

    if (!m) {
      throw new Error(`ONLY_RUNS is invalid: "${raw}"`);
    }

    const from = Number(String(m[1]));
    const to = m[2] ? Number(String(m[2])) : from;

    for (let r = from; r <= to; r += 1) {
      if (r < 1 || r > runCount) {
        throw new Error(`ONLY_RUNS ${r} is outside 1..${runCount}`);
      }

      chosen.add(r);
    }
  }

  return all.filter((r: number) => chosen.has(r));
}

function makeRng(seed: number) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rng = makeRng(seed);

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }

  return out;
}

function gitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();

    const changed = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line: string) => !line.includes('experiments/results/'));

    return {
      commit,
      so_tep_sua_ngoai_ket_qua: changed.length,
      tep_sua: changed.slice(0, 30),
    };
  } catch (error: any) {
    return {
      error: String(error?.message || error),
    };
  }
}

function machineInfo() {
  const cpu = os.cpus();

  return {
    cpu: cpu[0] ? cpu[0].model : '',
    so_luong_cpu: cpu.length,
    ram_gb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    he_dieu_hanh: `${os.platform()} ${os.release()}`,
    node: process.version,
  };
}

function proverInfo() {
  const file = proverBinary();
  const content = fs.readFileSync(file);

  return {
    duong_dan: path.relative(PROJECT_ROOT, file),
    kich_thuoc: content.length,
    sua_luc: fs.statSync(file).mtime.toISOString(),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function assertProverRebuilt() {
  const content = fs.readFileSync(proverBinary());

  if (!content.includes('check-k') || !content.includes('HALO2_K') || !content.includes('MERKLE_DEPTH')) {
    throw new Error(
      'prover.exe has not been rebuilt since the repeated-runs runner was added (no check-k mode /' +
        ' no HALO2_K variable). Run: cargo build --release -p prover',
    );
  }
}

function setCircuitEnv(d: number, k: number) {
  process.env.MERKLE_DEPTH = String(d);
  process.env.HALO2_K = String(k);
}

function clearCircuitEnv() {
  delete process.env.MERKLE_DEPTH;
  delete process.env.HALO2_K;
}

function findSmallestK(d: number): any {
  const file = path.join(RESULTS_ROOT, 'by_depth', `d${d}`, 'k.json');

  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  const attempts: any[] = [];
  let found = -1;

  for (let k = K_PROBE_MIN; k <= K_PROBE_MAX; k += 1) {
    setCircuitEnv(d, k);

    try {
      const result = runProver('check-k', {});
      attempts.push({ k, du_hang: true, check_ms: result.check_ms });
      found = k;
      break;
    } catch (_error) {
      attempts.push({ k, du_hang: false });
    }
  }

  clearCircuitEnv();

  if (found < 0) {
    throw new Error(`No K ≤ ${K_PROBE_MAX} has enough rows for d = ${d}`);
  }

  if (found === K_PROBE_MIN) {
    console.log(
      `  ⚠️ d = ${d}: K = ${found} is the bottom of the probed range,` +
        ' so K − 1 was never checked. Lower K_PROBE_MIN if needed.',
    );
  }

  const result = {
    d,
    k_toi_thieu: found,
    k_thieu_hang: found - 1,
    phep_thu: 'keygen_vk on the witness-free circuit (mode check-k)',
    cac_lan_thu: attempts,
    do_luc: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2));

  return result;
}

function loadDataset(cfg: Config): any {
  if (cfg.experiment === 'by_n') {
    const ds = readDataset(cfg.n);

    if (!Array.isArray(ds.students) || ds.students.length !== cfg.n) {
      throw new Error(`dataset_n${cfg.n}.json does not hold exactly ${cfg.n} students`);
    }

    if (Number(ds.merkle_depth) !== DEFAULT_DEPTH) {
      throw new Error(`dataset_n${cfg.n}.json says merkle_depth = ${ds.merkle_depth}, expected ${DEFAULT_DEPTH}`);
    }

    return ds;
  }

  if (cfg.n > 2 ** cfg.d) {
    throw new Error(`n = ${cfg.n} exceeds the 2^${cfg.d} capacity of the tree`);
  }

  const source = readDataset(SOURCE_N);

  if (!Array.isArray(source.students) || source.students.length < cfg.n) {
    throw new Error(`dataset_n${SOURCE_N}.json does not hold ${cfg.n} students`);
  }

  return {
    ...source,
    n: cfg.n,
    merkle_depth: cfg.d,
    students: source.students.slice(0, cfg.n),
  };
}

function runDirName(run: number) {
  return `run${String(run).padStart(2, '0')}`;
}

async function runOnce(cfg: Config, run: number, k: number, school: string, warmupCount: number): Promise<boolean> {
  const dir = path.join(RESULTS_ROOT, cfg.experiment, cfg.name, runDirName(run));
  const doneFile = path.join(dir, 'done.json');

  if (fs.existsSync(doneFile)) {
    console.log(`SKIP ${cfg.experiment}/${cfg.name}/${runDirName(run)} — already finished`);
    return false;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  setCircuitEnv(cfg.d, k);

  const dataset = loadDataset(cfg);
  const startedAt = new Date();
  const t0 = performance.now();

  console.log(
    `\n###### ${cfg.experiment} ${cfg.name} — ${runDirName(run)}` +
      ` (n = ${cfg.n}, d = ${cfg.d}, K = ${k}, warm-up ${warmupCount})`,
  );

  const snapshotId = await callRpc('evm_snapshot');

  if (!snapshotId) {
    throw new Error('Ganache returned no snapshot id before the run — stopping.');
  }

  let result: any;

  try {
    result = await runScenario(cfg.n, school, {
      dataset,
      warmupCount,
      writeResultFiles: false,
      warmMode: WARM_MODE,
    });
  } finally {
    const reverted = await callRpc('evm_revert', [snapshotId]);

    if (reverted !== true) {
      throw new Error(
        `evm_revert returned ${JSON.stringify(reverted)} after the run` + ' — the chain was not cleaned up, stopping.',
      );
    }
  }

  const expectedRows = warmupCount + cfg.n;

  if (result.performanceRows.length !== expectedRows || result.gasRows.length !== expectedRows) {
    throw new Error(
      `Run ${runDirName(run)} of ${cfg.name}: expected ${expectedRows} rows,` +
        ` got ${result.performanceRows.length} performance` +
        ` / ${result.gasRows.length} gas`,
    );
  }

  const PREFIX = 'thi_nghiem,run_id,iteration,warmup,d,k,';

  const writeCsv = (name: string, header: string, rows: MeasuredRow[]) => {
    fs.writeFileSync(
      path.join(dir, name),
      PREFIX +
        header +
        rows
          .map((x: MeasuredRow) => [cfg.experiment, run, x.iteration, x.warmup, cfg.d, k, x.row].join(','))
          .join('\n') +
        '\n',
    );
  };

  writeCsv(`performance_${MECHANISM}.csv`, PERFORMANCE_CSV_HEADER, result.performanceRows);
  writeCsv(`gas_${MECHANISM}.csv`, CSV_GAS_HEADER, result.gasRows);

  fs.writeFileSync(path.join(dir, 'proofs.json'), JSON.stringify(result.proofs, null, 2));

  fs.writeFileSync(
    doneFile,
    JSON.stringify(
      {
        mechanism: MECHANISM,
        thi_nghiem: cfg.experiment,
        cau_hinh: cfg.name,
        run_id: run,
        n: cfg.n,
        d: cfg.d,
        k,
        warmup: warmupCount,
        so_lan_do: cfg.n,
        che_do: MODE,
        tien_trinh: WARM_MODE
          ? 'one prove-batch process for the whole run: keygen once, warm-up, then n proofs, verify in the same process'
          : 'every proof and every verify is a new prover process',
        bat_dau: startedAt.toISOString(),
        ket_thuc: new Date().toISOString(),
        thoi_gian_ms: Number((performance.now() - t0).toFixed(1)),
      },
      null,
      2,
    ),
  );

  return true;
}

async function main() {
  const experiment = String(process.env.EXPERIMENT || '').trim();

  if (experiment !== 'by_n' && experiment !== 'by_depth') {
    throw new Error('Set EXPERIMENT=by_n or EXPERIMENT=by_depth');
  }

  const runCount = readInt('RUNS', 20, 1, 100);
  const warmupCount = readInt('WARMUP', 3, 0, 20);
  const seed = readInt('SEED', 20260915, 0, 2147483647);
  const runsToDo = readRuns(runCount);

  let configs: Config[];

  if (experiment === 'by_n') {
    configs = readList('SCENARIOS', [1, 10, 30, 60, 100, 500], (x: number) =>
      [1, 10, 30, 60, 100, 353, 500].includes(x),
    ).map((n: number): Config => ({
      experiment: 'by_n',
      name: `n${n}`,
      n,
      d: DEFAULT_DEPTH,
    }));
  } else {
    const fixedN = process.env.N_PER_DEPTH ? readInt('N_PER_DEPTH', 30, 1, SOURCE_N) : 0;

    configs = readList('DEPTHS', [1, 2, 3, 4, 5, 6, 7, 8], (x: number) => x >= 1 && x <= 24).map(
      (d: number): Config => ({
        experiment: 'by_depth',
        name: `d${d}`,
        n: fixedN > 0 ? fixedN : 2 ** d,
        d,
      }),
    );

    const tooBig = configs.filter((c: Config) => c.n > SOURCE_N);

    if (tooBig.length > 0) {
      throw new Error(
        `${tooBig[0]?.name} needs ${tooBig[0]?.n} students but the source dataset` +
          ` only holds ${SOURCE_N}. Drop that d from DEPTHS.`,
      );
    }
  }

  const order = runsToDo.map((run: number) => ({
    luot: run,
    cau_hinh: shuffle(configs, seed + run).map((c: Config) => c.name),
  }));

  const totalMeasurements = runsToDo.length * configs.reduce((s: number, c: Config) => s + c.n, 0);

  console.log(
    `Repeated runs — ${MECHANISM} branch — ${experiment}` +
      `  [mode: ${MODE}${WARM_MODE ? ' — one prover process per run' : ' — one prover process per proof'}]`,
  );
  console.log(`  configurations : ${configs.map((c: Config) => c.name).join(', ')}`);
  console.log(`  runs           : ${runsToDo.join(', ')} (out of ${runCount})`);
  console.log(`  warm-up        : ${warmupCount} per run`);
  console.log(`  measurements   : ${totalMeasurements} (warm-up excluded)`);
  console.log(`  results        : ${path.relative(PROJECT_ROOT, RESULTS_ROOT)}`);
  order.slice(0, 3).forEach((o: any) => console.log(`  order ${runDirName(o.luot)}: ${o.cau_hinh.join(' → ')}`));

  if (process.env.PLAN_ONLY === '1') {
    console.log('\nPLAN_ONLY=1 — nothing else is run.');
    return;
  }

  assertProverRebuilt();

  const accounts: string[] = await web3.eth.getAccounts();
  const school = accounts[0];

  if (!school) {
    throw new Error('Ganache has no accounts');
  }

  const addresses = Array.from(
    new Set(configs.flatMap((c: Config) => loadDataset(c).students.map((student: any) => student.address))),
  ) as string[];

  await assertMeasurementEnvironment(addresses);

  const kByConfig = new Map<string, number>();
  const kDetails: any[] = [];

  for (const c of configs) {
    if (c.experiment === 'by_depth') {
      const found = findSmallestK(c.d);
      kByConfig.set(c.name, found.k_toi_thieu);
      kDetails.push(found);
      console.log(`  d = ${c.d}: smallest K = ${found.k_toi_thieu}`);
    } else {
      kByConfig.set(c.name, DEFAULT_K);
    }
  }

  fs.mkdirSync(path.join(RESULTS_ROOT, experiment), { recursive: true });

  const configFile = path.join(RESULTS_ROOT, 'run_config.json');
  const store = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};

  const entry = store[experiment] || {};

  entry.mechanism = MECHANISM;
  entry.so_luot = runCount;
  entry.warmup = warmupCount;
  entry.hat_giong = seed;
  entry.che_do = MODE;
  entry.cau_hinh = configs;
  entry.k_theo_cau_hinh = Object.fromEntries(kByConfig);
  entry.tim_k = kDetails;
  entry.dinh_nghia_luot =
    'one run = chain snapshot → warm-up → n measurements → revert;' +
    (WARM_MODE
      ? ' ONE prove-batch process for the whole run (keygen once, verify in the same process)'
      : ' every proof/verify is a new prover process') +
    '; configuration order reshuffled every round';
  entry.lan_khoi_chay = (entry.lan_khoi_chay || []).concat([
    {
      bat_dau: new Date().toISOString(),
      luot_chon: runsToDo,
      thu_tu: order,
      may: machineInfo(),
      git: gitInfo(),
      prover: proverInfo(),
    },
  ]);

  store[experiment] = entry;
  fs.writeFileSync(configFile, JSON.stringify(store, null, 2));

  const tStart = performance.now();
  let ranCount = 0;
  let skippedCount = 0;

  try {
    for (const o of order) {
      for (const name of o.cau_hinh) {
        const c = configs.find((x: Config) => x.name === name) as Config;
        const k = kByConfig.get(name) as number;

        if (await runOnce(c, o.luot, k, school, warmupCount)) {
          ranCount += 1;
        } else {
          skippedCount += 1;
        }
      }
    }
  } finally {
    clearCircuitEnv();
  }

  console.log(
    `\nRepeated runs ${experiment} finished: ${ranCount} runs done, ${skippedCount} skipped,` +
      ` ${((performance.now() - tStart) / 60000).toFixed(1)} minutes.`,
  );
  console.log('Mean ± SD summary: npm run experiment:repeated:summary');
}

main().catch((error: any) => {
  console.error(error);
  process.exit(1);
});
