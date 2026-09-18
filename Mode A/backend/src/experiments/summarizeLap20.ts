/*
 * LAP20 SUMMARY — Mean ± SD per configuration, from the finished runs.
 *
 * SHARED by both branches (ADV and ONC hold byte-identical copies of this
 * file): the branch is recognised from the file names inside a run folder
 * (performance_offchain.csv or performance_onchain.csv).
 *
 * It reads <RESULTS_ROOT>/<experiment>/<configuration>/luotNN/ — ONLY the runs
 * that have xong.json — DROPS every warmup = true row, and computes for each
 * metric: N, mean, SD (sample, divided by N − 1), min, max.
 *
 * A metric that is CONSTANT within a run (ONC's setup_ms, update_root_gas,
 * deploy_*) contributes ONE value per run, so N = R. Without that, a quantity
 * measured ONCE would be counted n times and the SD would be falsely narrow.
 * The `cach_dem` column records which counting rule each metric got.
 *
 * Output:
 *   <configuration>/tong_hop_<configuration>.csv   Mean ± SD of that configuration
 *   <configuration>/theo_luot.csv                  per-run averages
 *   <experiment>/tong_hop_<experiment>.csv         every configuration together
 *   <experiment>/bang_bai_bao_<experiment>.csv     "mean ± SD", ready for the paper
 * theo_n also gets an n = 500 row from luot_bao_cao (the 12/09 lot, R = 1,
 * N = 500) — ONLY while lap20 has no n500 of its own (since 14/09, n = 500 is
 * run 20 times too).
 *
 * It touches neither Ganache, nor the prover, nor MongoDB, and can be re-run
 * any number of times.
 *
 * Run: npm run experiment:lap20:tonghop
 * Variables: THU_MUC_LAP (as in lap20Experiment.ts), SO_LUOT (default 20, only
 * used for the warning)
 */
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const RESULTS_ROOT =
    path.resolve(
        PROJECT_ROOT,
        process.env.THU_MUC_LAP
        || "experiments/results/quantitative/lap20_1509"
    );

const REPORT_LOT_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/results/quantitative/luot_bao_cao"
    );

const EXPECTED_RUNS =
    Number(process.env.SO_LUOT || 20);

// K of the 12/09 lot per branch — used by the n = 500 row taken from luot_bao_cao.
const K_OF_REPORT_LOT: Record<string, number> = {
    offchain: 9,
    onchain: 13
};

const NON_METRIC_COLUMNS = new Set([
    "thi_nghiem",
    "run_id",
    "iteration",
    "warmup",
    "d",
    "k",
    "mechanism",
    "n",
    "student_index",
    "root",
    "nullifier",
    "verified"
]);

/*
 * Columns that go into the paper table, per branch. `tach_gas` (ONC) =
 * verify_record_gas + settle_gas — one withdrawal under the split design, the
 * column comparable with ADV's withdraw_gas.
 */
const PAPER_COLUMNS: Record<string, string[]> = {
    offchain: [
        "withdraw_gas",
        "proof_generation_ms",
        "verify_native_ms",
        "setup_ms"
    ],
    onchain: [
        "tach_gas",
        "verify_record_gas",
        "settle_gas",
        "proof_generation_ms",
        "verify_native_ms",
        "verify_onchain_ms",
        "setup_ms"
    ]
};

type Row = Record<string, string>;

type Stat = {
    metric: string;
    cach_dem: string;
    R: number;
    N: number;
    mean: number;
    sd: number;
    min: number;
    max: number;
};

function readCsv(
    file: string
): Row[] {
    const lines = fs
        .readFileSync(file, "utf8")
        .replace(/^﻿/, "")
        .split(/\r?\n/)
        .filter((x: string) => x.length > 0);

    const header = String(lines[0] || "").split(",");

    return lines.slice(1).map((line: string) => {
        const row: Row = {};
        const cells = line.split(",");
        header.forEach((h: string, i: number) => {
            row[h] = cells[i] ?? "";
        });
        return row;
    });
}

function unitOf(
    metric: string
) {
    if (metric.endsWith("_ms")) return "ms";
    if (metric.endsWith("_gas")) return "gas";
    if (metric.endsWith("_bytes")) return "B";
    return "";
}

function toNumber(
    x: string | undefined
): number | null {
    if (x === undefined || x.trim() === "") {
        return null;
    }

    const v = Number(x);

    return Number.isFinite(v) ? v : null;
}

function describe(
    values: number[]
) {
    const N = values.length;
    const mean = values.reduce((a: number, b: number) => a + b, 0) / N;
    const sd = N > 1
        ? Math.sqrt(values.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / (N - 1))
        : NaN;

    return {
        N,
        mean,
        sd,
        min: Math.min(...values),
        max: Math.max(...values)
    };
}

/*
 * `runs` is the list of runs, each one an array of rows with the warm-up
 * ALREADY removed. Metrics that are constant within a run are detected here
 * and counted once per run.
 */
function statsForConfig(
    runs: Row[][]
): Stat[] {
    const allRows = runs.flat();

    if (allRows.length === 0) {
        return [];
    }

    const columns = Object.keys(allRows[0] as Row)
        .filter((c: string) => !NON_METRIC_COLUMNS.has(c));

    const out: Stat[] = [];

    for (const metric of columns) {
        const perRun: number[][] = runs.map((rows: Row[]) =>
            rows
                .map((r: Row) => toNumber(r[metric]))
                .filter((x: number | null): x is number => x !== null)
        );

        const nonEmpty = perRun.filter((v: number[]) => v.length > 0);

        if (nonEmpty.length === 0) {
            continue;
        }

        const constantWithinRun = nonEmpty.every(
            (v: number[]) => new Set(v).size === 1
        );

        const values = constantWithinRun
            ? nonEmpty.map((v: number[]) => v[0] as number)
            : nonEmpty.flat();

        const stat = describe(values);

        out.push({
            metric,
            cach_dem: constantWithinRun ? "moi_luot" : "moi_lan_do",
            R: nonEmpty.length,
            ...stat
        });
    }

    return out;
}

/*
 * Join the performance row and the gas row of the same measurement by
 * (run_id, iteration) — the two files record the same warm-up/measured
 * iteration at the same position. `tach_gas` is added for ONC.
 */
function joinRows(
    perf: Row[],
    gas: Row[]
): Row[] {
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

function detectBranch(
    runDir: string
): string | null {
    if (fs.existsSync(path.join(runDir, "performance_onchain.csv"))) return "onchain";
    if (fs.existsSync(path.join(runDir, "performance_offchain.csv"))) return "offchain";
    return null;
}

function quote(
    x: unknown
) {
    const s = String(x);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function num(
    x: number
) {
    return Number.isFinite(x) ? String(Number(x.toFixed(6))) : "";
}

function format(
    stat: Stat
) {
    const digits = stat.metric.endsWith("_ms") ? 1 : 0;
    const mean = stat.mean.toFixed(digits);

    return Number.isFinite(stat.sd)
        ? `${mean} ± ${stat.sd.toFixed(digits)}`
        : mean;
}

const SUMMARY_HEADER =
    "thi_nghiem,mechanism,cau_hinh,n,d,k,metric,cach_dem,R,N,mean,sd,min,max,don_vi,nguon\n";

function summaryRow(
    experiment: string,
    mechanism: string,
    configName: string,
    n: string,
    d: string,
    k: string,
    stat: Stat,
    source: string
) {
    return [
        experiment,
        mechanism,
        configName,
        n,
        d,
        k,
        stat.metric,
        stat.cach_dem,
        stat.R,
        stat.N,
        num(stat.mean),
        num(stat.sd),
        num(stat.min),
        num(stat.max),
        unitOf(stat.metric),
        source
    ].map(quote).join(",");
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

function summarizeConfig(
    experiment: string,
    configDir: string
): ConfigResult | null {
    const configName = path.basename(configDir);

    const runDirs = fs
        .readdirSync(configDir)
        .filter((x: string) => /^luot\d+$/.test(x))
        .map((x: string) => path.join(configDir, x))
        .filter((x: string) => fs.existsSync(path.join(x, "xong.json")))
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

        return joinRows(perf, gas).filter((r: Row) => r.warmup !== "true");
    });

    const firstRow = (rowsPerRun[0] || [])[0] || {};
    const stats = statsForConfig(rowsPerRun);

    // Per-run averages — to see whether the runs are stable.
    let runCsv = "run_id,metric,N,mean\n";

    runDirs.forEach((_: string, i: number) => {
        const rows = rowsPerRun[i] || [];
        const runId = (rows[0] || {}).run_id || String(i + 1);

        for (const stat of stats) {
            const values = rows
                .map((r: Row) => toNumber(r[stat.metric]))
                .filter((x: number | null): x is number => x !== null);

            if (values.length > 0) {
                runCsv += [runId, stat.metric, values.length, num(describe(values).mean)]
                    .map(quote).join(",") + "\n";
            }
        }
    });

    fs.writeFileSync(path.join(configDir, "theo_luot.csv"), runCsv);

    fs.writeFileSync(
        path.join(configDir, `tong_hop_${configName}.csv`),
        SUMMARY_HEADER
        + stats
            .map((stat: Stat) => summaryRow(
                experiment, mechanism, configName,
                String(firstRow.n), String(firstRow.d), String(firstRow.k),
                stat, "lap20"
            ))
            .join("\n")
        + "\n"
    );

    const extra: Record<string, string> = {};
    const verifierFile = path.join(configDir, "verifier.json");
    const kFile = path.join(configDir, "k.json");

    if (fs.existsSync(verifierFile)) {
        const v = JSON.parse(fs.readFileSync(verifierFile, "utf8"));
        extra.verifier_bytecode_bytes = String(v.deployed_bytecode_bytes);
        extra.eip170_pct = String(v.eip170_pct);
    }

    if (fs.existsSync(kFile)) {
        extra.k_thieu_hang = String(JSON.parse(fs.readFileSync(kFile, "utf8")).k_thieu_hang);
    }

    if (runDirs.length < EXPECTED_RUNS) {
        console.log(
            `  ⚠️ ${experiment}/${configName}: only ${runDirs.length}/${EXPECTED_RUNS} runs finished`
        );
    }

    return {
        configName,
        mechanism,
        n: String(firstRow.n),
        d: String(firstRow.d),
        k: String(firstRow.k),
        stats,
        source: "lap20",
        extra
    };
}

/*
 * The n = 500 row of the 12/09 lot (luot_bao_cao) — ONE run, 500 measurements,
 * NO warm-up. It carries its own `nguon` value so nobody accidentally mixes it
 * with the lap20 numbers.
 */
function summarizeReportLot(
    mechanism: string
): ConfigResult | null {
    const perfFile = path.join(REPORT_LOT_DIR, `performance_${mechanism}_n500.csv`);
    const gasFile = path.join(REPORT_LOT_DIR, `gas_${mechanism}_n500.csv`);

    if (!fs.existsSync(perfFile) || !fs.existsSync(gasFile)) {
        return null;
    }

    const perf = readCsv(perfFile).map((r: Row) => ({ ...r, run_id: "1", iteration: String(Number(r.student_index) + 1) }));
    const gas = readCsv(gasFile).map((r: Row) => ({ ...r, run_id: "1", iteration: String(Number(r.student_index) + 1) }));

    return {
        configName: "n500",
        mechanism,
        n: "500",
        d: "9",
        k: String(K_OF_REPORT_LOT[mechanism]),
        stats: statsForConfig([joinRows(perf, gas)]),
        source: "luot_bao_cao_12_09",
        extra: {}
    };
}

function summarizeExperiment(
    experiment: string
) {
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

    /*
     * The 12/09 row is added ONLY while lap20 has NO n500 of its own. Two
     * n500 rows at once would make the paper table quote the wrong one.
     */
    if (
        experiment === "theo_n"
        && !results.some((r: ConfigResult) => r.configName === "n500")
    ) {
        const reportLot = summarizeReportLot(mechanism);

        if (reportLot) {
            results.push(reportLot);
        }
    }

    results.sort((a: ConfigResult, b: ConfigResult) =>
        experiment === "theo_n"
            ? Number(a.n) - Number(b.n)
            : Number(a.d) - Number(b.d)
    );

    fs.writeFileSync(
        path.join(dir, `tong_hop_${experiment}.csv`),
        SUMMARY_HEADER
        + results
            .flatMap((r: ConfigResult) => r.stats.map((stat: Stat) =>
                summaryRow(experiment, r.mechanism, r.configName, r.n, r.d, r.k, stat, r.source)
            ))
            .join("\n")
        + "\n"
    );

    const columns = PAPER_COLUMNS[mechanism] || [];
    const extraColumns = experiment === "theo_d"
        ? (mechanism === "onchain" ? ["verifier_bytecode_bytes", "eip170_pct"] : ["k_thieu_hang"])
        : [];

    let table = ["thi_nghiem", "cau_hinh", "n", "d", "k", "R", "N", ...columns, ...extraColumns, "nguon"].join(",") + "\n";

    for (const r of results) {
        const byName = new Map(r.stats.map((stat: Stat) => [stat.metric, stat]));
        const main = byName.get("proof_generation_ms");

        table += [
            experiment,
            r.configName,
            r.n,
            r.d,
            r.k,
            main ? main.R : "",
            main ? main.N : "",
            ...columns.map((c: string) => {
                const stat = byName.get(c);
                return stat ? format(stat) : "";
            }),
            ...extraColumns.map((c: string) => r.extra[c] || ""),
            r.source
        ].map(quote).join(",") + "\n";
    }

    fs.writeFileSync(path.join(dir, `bang_bai_bao_${experiment}.csv`), table);

    console.log(
        `${experiment} (${mechanism}): ${results.length} configurations → `
        + path.relative(PROJECT_ROOT, path.join(dir, `tong_hop_${experiment}.csv`))
    );
}

function main() {
    if (!fs.existsSync(RESULTS_ROOT)) {
        throw new Error(
            `No ${path.relative(PROJECT_ROOT, RESULTS_ROOT)} — run experiment:lap20 first`
        );
    }

    summarizeExperiment("theo_n");
    summarizeExperiment("theo_d");
}

main();
