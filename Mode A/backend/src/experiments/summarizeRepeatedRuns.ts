import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const RESULTS_ROOT = path.resolve(
  PROJECT_ROOT,
  process.env.RUNS_DIR || 'experiments/results/quantitative/repeated_runs',
);

const REPORT_LOT_DIR = path.resolve(PROJECT_ROOT, 'experiments/results/quantitative/report_run');

const EXPECTED_RUNS = Number(process.env.RUNS || 20);

const K_OF_REPORT_LOT: Record<string, number> = {
  offchain: 9,
  onchain: 13,
};

const NON_METRIC_COLUMNS = new Set([
  'thi_nghiem',
  'run_id',
  'iteration',
  'warmup',
  'd',
  'k',
  'mechanism',
  'n',
  'student_index',
  'root',
  'nullifier',
  'verified',
]);

const PAPER_COLUMNS: Record<string, string[]> = {
  offchain: ['withdraw_gas', 'proof_generation_ms', 'verify_native_ms', 'setup_ms'],
  onchain: [
    'tach_gas',
    'verify_record_gas',
    'settle_gas',
    'proof_generation_ms',
    'verify_native_ms',
    'verify_onchain_ms',
    'setup_ms',
  ],
};

type Row = Record<string, string>;

type Stat = {
  metric: string;
  countedAs: string;
  R: number;
  N: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
};

function readCsv(file: string): Row[] {
  const lines = fs
    .readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((x: string) => x.length > 0);

  const header = String(lines[0] || '').split(',');

  return lines.slice(1).map((line: string) => {
    const row: Row = {};
    const cells = line.split(',');
    header.forEach((h: string, i: number) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}

function unitOf(metric: string) {
  if (metric.endsWith('_ms')) return 'ms';
  if (metric.endsWith('_gas')) return 'gas';
  if (metric.endsWith('_bytes')) return 'B';
  return '';
}

function toNumber(x: string | undefined): number | null {
  if (x === undefined || x.trim() === '') {
    return null;
  }

  const v = Number(x);

  return Number.isFinite(v) ? v : null;
}

function describe(values: number[]) {
  const N = values.length;
  const mean = values.reduce((a: number, b: number) => a + b, 0) / N;
  const sd = N > 1 ? Math.sqrt(values.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / (N - 1)) : NaN;

  return {
    N,
    mean,
    sd,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function statsForConfig(runs: Row[][]): Stat[] {
  const allRows = runs.flat();

  if (allRows.length === 0) {
    return [];
  }

  const columns = Object.keys(allRows[0] as Row).filter((c: string) => !NON_METRIC_COLUMNS.has(c));

  const out: Stat[] = [];

  for (const metric of columns) {
    const perRun: number[][] = runs.map((rows: Row[]) =>
      rows.map((r: Row) => toNumber(r[metric])).filter((x: number | null): x is number => x !== null),
    );

    const nonEmpty = perRun.filter((v: number[]) => v.length > 0);

    if (nonEmpty.length === 0) {
      continue;
    }

    const constantWithinRun = nonEmpty.every((v: number[]) => new Set(v).size === 1);

    const values = constantWithinRun ? nonEmpty.map((v: number[]) => v[0] as number) : nonEmpty.flat();

    const stat = describe(values);

    out.push({
      metric,
      countedAs: constantWithinRun ? 'moi_luot' : 'moi_lan_do',
      R: nonEmpty.length,
      ...stat,
    });
  }

  return out;
}

function joinRows(perf: Row[], gas: Row[]): Row[] {
  const byKey = new Map<string, Row>();

  for (const g of gas) {
    byKey.set(`${g.run_id}|${g.iteration}|${g.student_index}`, g);
  }

  return perf.map((p: Row) => {
    const g = byKey.get(`${p.run_id}|${p.iteration}|${p.student_index}`) || {};
    const joined: Row = { ...g, ...p };

    const verifyRecord = toNumber(g.verify_record_gas);
    const settle = toNumber(g.settle_gas);

    if (verifyRecord !== null && settle !== null) {
      joined.tach_gas = String(verifyRecord + settle);
    }

    return joined;
  });
}

function detectBranch(runDir: string): string | null {
  if (fs.existsSync(path.join(runDir, 'performance_onchain.csv'))) return 'onchain';
  if (fs.existsSync(path.join(runDir, 'performance_offchain.csv'))) return 'offchain';
  return null;
}

function quote(x: unknown) {
  const s = String(x);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function num(x: number) {
  return Number.isFinite(x) ? String(Number(x.toFixed(6))) : '';
}

function format(stat: Stat) {
  const digits = stat.metric.endsWith('_ms') ? 1 : 0;
  const mean = stat.mean.toFixed(digits);

  return Number.isFinite(stat.sd) ? `${mean} ± ${stat.sd.toFixed(digits)}` : mean;
}

const SUMMARY_HEADER = 'thi_nghiem,mechanism,cau_hinh,n,d,k,metric,cach_dem,R,N,mean,sd,min,max,don_vi,nguon\n';

function summaryRow(
  experiment: string,
  mechanism: string,
  configName: string,
  n: string,
  d: string,
  k: string,
  stat: Stat,
  source: string,
) {
  return [
    experiment,
    mechanism,
    configName,
    n,
    d,
    k,
    stat.metric,
    stat.countedAs,
    stat.R,
    stat.N,
    num(stat.mean),
    num(stat.sd),
    num(stat.min),
    num(stat.max),
    unitOf(stat.metric),
    source,
  ]
    .map(quote)
    .join(',');
}

type ConfigResult = {
  configName: string;
  mechanism: string;
  n: string;
  d: string;
  k: string;
  stats: Stat[];
  source: string;
  extra: Record<string, string>;
};

function summarizeConfig(experiment: string, configDir: string): ConfigResult | null {
  const configName = path.basename(configDir);

  const runDirs = fs
    .readdirSync(configDir)
    .filter((x: string) => /^run\d+$/.test(x))
    .map((x: string) => path.join(configDir, x))
    .filter((x: string) => fs.existsSync(path.join(x, 'done.json')))
    .sort();

  if (runDirs.length === 0) {
    return null;
  }

  const mechanism = detectBranch(runDirs[0] as string);

  if (!mechanism) {
    return null;
  }

  const rowsPerRun: Row[][] = runDirs.map((runDir: string) => {
    const perf = readCsv(path.join(runDir, `performance_${mechanism}.csv`));
    const gas = readCsv(path.join(runDir, `gas_${mechanism}.csv`));

    return joinRows(perf, gas).filter((r: Row) => r.warmup !== 'true');
  });

  const firstRow = (rowsPerRun[0] || [])[0] || {};
  const stats = statsForConfig(rowsPerRun);

  let runCsv = 'run_id,metric,N,mean\n';

  runDirs.forEach((_: string, i: number) => {
    const rows = rowsPerRun[i] || [];
    const runId = (rows[0] || {}).run_id || String(i + 1);

    for (const stat of stats) {
      const values = rows
        .map((r: Row) => toNumber(r[stat.metric]))
        .filter((x: number | null): x is number => x !== null);

      if (values.length > 0) {
        runCsv += [runId, stat.metric, values.length, num(describe(values).mean)].map(quote).join(',') + '\n';
      }
    }
  });

  fs.writeFileSync(path.join(configDir, 'per_run.csv'), runCsv);

  fs.writeFileSync(
    path.join(configDir, `summary_${configName}.csv`),
    SUMMARY_HEADER +
      stats
        .map((stat: Stat) =>
          summaryRow(
            experiment,
            mechanism,
            configName,
            String(firstRow.n),
            String(firstRow.d),
            String(firstRow.k),
            stat,
            'lap20',
          ),
        )
        .join('\n') +
      '\n',
  );

  const extra: Record<string, string> = {};
  const verifierFile = path.join(configDir, 'verifier.json');
  const kFile = path.join(configDir, 'k.json');

  if (fs.existsSync(verifierFile)) {
    const v = JSON.parse(fs.readFileSync(verifierFile, 'utf8'));
    extra.verifier_bytecode_bytes = String(v.deployed_bytecode_bytes);
    extra.eip170_pct = String(v.eip170_pct);
  }

  if (fs.existsSync(kFile)) {
    extra.k_thieu_hang = String(JSON.parse(fs.readFileSync(kFile, 'utf8')).k_thieu_hang);
  }

  if (runDirs.length < EXPECTED_RUNS) {
    console.log(`  ⚠️ ${experiment}/${configName}: only ${runDirs.length}/${EXPECTED_RUNS} runs finished`);
  }

  return {
    configName,
    mechanism,
    n: String(firstRow.n),
    d: String(firstRow.d),
    k: String(firstRow.k),
    stats,
    source: 'lap20',
    extra,
  };
}

function summarizeReportLot(mechanism: string): ConfigResult | null {
  const perfFile = path.join(REPORT_LOT_DIR, `performance_${mechanism}_n500.csv`);
  const gasFile = path.join(REPORT_LOT_DIR, `gas_${mechanism}_n500.csv`);

  if (!fs.existsSync(perfFile) || !fs.existsSync(gasFile)) {
    return null;
  }

  const perf = readCsv(perfFile).map((r: Row) => ({
    ...r,
    run_id: '1',
    iteration: String(Number(r.student_index) + 1),
  }));
  const gas = readCsv(gasFile).map((r: Row) => ({ ...r, run_id: '1', iteration: String(Number(r.student_index) + 1) }));

  return {
    configName: 'n500',
    mechanism,
    n: '500',
    d: '9',
    k: String(K_OF_REPORT_LOT[mechanism]),
    stats: statsForConfig([joinRows(perf, gas)]),
    source: 'report_run_12_09',
    extra: {},
  };
}

function summarizeExperiment(experiment: string) {
  const dir = path.join(RESULTS_ROOT, experiment);

  if (!fs.existsSync(dir)) {
    console.log(`(no ${path.relative(PROJECT_ROOT, dir)} yet — skipped)`);
    return;
  }

  const results: ConfigResult[] = fs
    .readdirSync(dir)
    .map((x: string) => path.join(dir, x))
    .filter((x: string) => fs.statSync(x).isDirectory())
    .map((x: string) => summarizeConfig(experiment, x))
    .filter((x: ConfigResult | null): x is ConfigResult => x !== null);

  if (results.length === 0) {
    console.log(`(${experiment}: no run has finished yet)`);
    return;
  }

  const mechanism = (results[0] as ConfigResult).mechanism;

  if (experiment === 'by_n' && !results.some((r: ConfigResult) => r.configName === 'n500')) {
    const reportLot = summarizeReportLot(mechanism);

    if (reportLot) {
      results.push(reportLot);
    }
  }

  results.sort((a: ConfigResult, b: ConfigResult) =>
    experiment === 'by_n' ? Number(a.n) - Number(b.n) : Number(a.d) - Number(b.d),
  );

  fs.writeFileSync(
    path.join(dir, `summary_${experiment}.csv`),
    SUMMARY_HEADER +
      results
        .flatMap((r: ConfigResult) =>
          r.stats.map((stat: Stat) => summaryRow(experiment, r.mechanism, r.configName, r.n, r.d, r.k, stat, r.source)),
        )
        .join('\n') +
      '\n',
  );

  const columns = PAPER_COLUMNS[mechanism] || [];
  const extraColumns =
    experiment === 'by_depth'
      ? mechanism === 'onchain'
        ? ['verifier_bytecode_bytes', 'eip170_pct']
        : ['k_thieu_hang']
      : [];

  let table =
    ['thi_nghiem', 'cau_hinh', 'n', 'd', 'k', 'R', 'N', ...columns, ...extraColumns, 'nguon'].join(',') + '\n';

  for (const r of results) {
    const byName = new Map(r.stats.map((stat: Stat) => [stat.metric, stat]));
    const main = byName.get('proof_generation_ms');

    table +=
      [
        experiment,
        r.configName,
        r.n,
        r.d,
        r.k,
        main ? main.R : '',
        main ? main.N : '',
        ...columns.map((c: string) => {
          const stat = byName.get(c);
          return stat ? format(stat) : '';
        }),
        ...extraColumns.map((c: string) => r.extra[c] || ''),
        r.source,
      ]
        .map(quote)
        .join(',') + '\n';
  }

  fs.writeFileSync(path.join(dir, `paper_table_${experiment}.csv`), table);

  console.log(
    `${experiment} (${mechanism}): ${results.length} configurations → ` +
      path.relative(PROJECT_ROOT, path.join(dir, `summary_${experiment}.csv`)),
  );
}

function main() {
  if (!fs.existsSync(RESULTS_ROOT)) {
    throw new Error(`No ${path.relative(PROJECT_ROOT, RESULTS_ROOT)} — run experiment:repeated first`);
  }

  summarizeExperiment('by_n');
  summarizeExperiment('by_depth');
}

main();
