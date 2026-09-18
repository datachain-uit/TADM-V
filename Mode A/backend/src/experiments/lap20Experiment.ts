/*
 * LAP20 — QUANTITATIVE EXPERIMENT, 20 INDEPENDENT RUNS — OFF-CHAIN BRANCH (ADV)
 *
 * Why this runner exists (2026-09-14): pre-submission feedback asks for
 * Mean ± SD, for the number of runs and the warm-up to be stated explicitly,
 * and for an extra experiment over the Merkle depth d. The 12/09 lot ran
 * EACH scenario ONCE.
 *
 * Two experiments, selected with THI_NGHIEM:
 *   theo_n : d = 9,  n ∈ {1, 10, 30, 60, 100, 500}   (353 dropped — user's call, 14/09)
 *   theo_d : d ∈ {1 … 8}, tree FILLED UP, n = 2^d (2 → 256 students)
 *            (d = 9 comes from theo_n/n500; set N_THEO_D to use a fixed n instead)
 *
 * ONE RUN = one complete pass over a single configuration, INDEPENDENT of
 * every other run:
 *   - the Ganache chain is snapshotted before the run and reverted after it
 *   - every proof is a NEW prover process (specific to this branch), so params
 *     loading + keygen repeat on every proof — exactly like the 12/09 lot
 *   - WARMUP generate + verify + withdraw iterations run first; they are
 *     recorded with warmup = true and do NOT count towards Mean ± SD
 * Order: rounds r = 1..R; inside each round the configurations are SHUFFLED
 * with a fixed seed — so machine drift over time does not pile up on one
 * configuration.
 *
 * Measured through `chayMotKichBan` of quantitativeExperiment.ts ITSELF — the
 * same clock boundaries as the 12/09 lot.
 *
 * Results: <RESULTS_ROOT>/<experiment>/<nN|dD>/luotNN/
 *   performance_offchain.csv · gas_offchain.csv · proofs.json · xong.json
 * A run folder holding `xong.json` counts as finished and is SKIPPED on a
 * re-run — stopping midway costs only the run in progress. An unfinished run
 * (no xong.json) is deleted and redone.
 *
 * Environment variables:
 *   THI_NGHIEM       theo_n | theo_d                          (required)
 *   SO_LUOT          runs per configuration                   (default 20)
 *   WARMUP           warm-up iterations per run               (default 3)
 *   KICH_BAN         n values for theo_n, e.g. 1,10           (default 1,10,30,60,100,500)
 *   DO_SAU           d values for theo_d, e.g. 1,2            (default 1..8)
 *   N_THEO_D         fixed n for every d                      (unset ⇒ fill the tree, n = 2^d)
 *   LUOT             run only these runs: 1 · 1-3 · 1,5       (for trial runs)
 *   HAT_GIONG        seed of the order shuffle                (default 20260915)
 *   THU_MUC_LAP      results root   (default experiments/results/quantitative/lap20_1509)
 *   CHI_IN_KE_HOACH  =1 prints the plan only, touches neither Ganache nor the prover
 *
 * Needs: Ganache on 8545 (--wallet.totalAccounts 501, mnemonic "test … junk"),
 * target/release/prover.exe built AFTER lap20 (it must have the check-k mode).
 * No MongoDB, no IPFS. Do NOT run at the same time as the ONC branch (shared
 * Ganache).
 */
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

const {
    runRust,
    getProverPath
} = require("../clients/prover/halo2ProverClient");

const {
    chayMotKichBan,
    assertMeasurementEnvironment,
    callRpc,
    readDataset,
    CSV_GAS_HEADER,
    CSV_HIEU_NANG_HEADER
} = require("./quantitativeExperiment");

const MECHANISM = "offchain";

const web3 =
    new Web3(
        "http://127.0.0.1:8545"
    );

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

/*
 * LAP20 (17/09/2026) — MEASUREMENT MODE, chosen with `CHE_DO`.
 *
 *   nguoi  (default) — one prover process per proof, and one more per
 *                      verification. This is what the real withdrawal flow
 *                      does, and it is what produced the 12/09 lot and the
 *                      lot in `lap20_1509`. Unchanged in every detail.
 *
 *   nong             — ONE `prove-batch` process for the whole run: key
 *                      generation once, then the proofs in a warm loop with
 *                      verification inside the same process. This is the
 *                      condition the on-chain branch is measured under, so
 *                      the two `setup_ms` columns become comparable.
 *
 * 🔴 The warm mode is NOT the real flow. Both branches spawn a fresh process
 * per withdrawal in production, so both regenerate the keys every time; no
 * implementation persists the proving key between withdrawals. The cold lot
 * is the evidence for that cost — which is why the two modes write to
 * DIFFERENT directories by default and never overwrite each other.
 */
const CHE_DO =
    (process.env.CHE_DO || "nguoi").trim();

if (CHE_DO !== "nguoi" && CHE_DO !== "nong") {
    throw new Error(
        `CHE_DO is invalid: "${CHE_DO}" (expected "nguoi" or "nong")`
    );
}

const CHE_DO_NONG =
    CHE_DO === "nong";

const RESULTS_ROOT =
    path.resolve(
        PROJECT_ROOT,
        process.env.THU_MUC_LAP
        || (CHE_DO_NONG
            ? "experiments/results/quantitative/lap_20"
            : "experiments/results/quantitative/lap20_1509")
    );

// Same defaults as prover/src (inputs_builder.rs, generate_proof.rs).
const DEFAULT_DEPTH = 9;
const DEFAULT_K = 9;

/*
 * The K range probed when looking for the smallest K of a given d. It starts
 * at 4, not at 9: a small tree (d < 9) fits in a K below 9, so the probe has
 * to go bottom-up for "smallest" to be a measurement.
 */
const K_PROBE_MIN = 4;
const K_PROBE_MAX = 16;

/*
 * Source dataset of the depth experiment: the FIRST `n` students of
 * `dataset_n500.json`. That keeps exactly the data already used by the
 * scenario experiment, so both experiments talk about the same students.
 */
const SOURCE_N = 500;

type Experiment = "theo_n" | "theo_d";

type Config = {
    experiment: Experiment;
    name: string;
    n: number;
    d: number;
};

type MeasuredRow = {
    warmup: boolean;
    lan: number;
    dong: string;
};

// =========================
// READING THE CONFIGURATION FROM THE ENVIRONMENT
// =========================

function readInt(
    name: string,
    fallback: number,
    min: number,
    max: number
): number {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") {
        return fallback;
    }

    const x = Number(raw.trim());

    if (!Number.isInteger(x) || x < min || x > max) {
        throw new Error(
            `${name} is invalid: "${raw}" (expected an integer ${min}..${max})`
        );
    }

    return x;
}

function readList(
    name: string,
    fallback: number[],
    isValid: (x: number) => boolean
): number[] {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") {
        return fallback;
    }

    const values = raw
        .split(",")
        .map((s: string) => Number(s.trim()));

    const bad = values.filter(
        (x: number) => !Number.isInteger(x) || !isValid(x)
    );

    if (values.length === 0 || bad.length > 0) {
        throw new Error(
            `${name} is invalid: "${raw}"`
        );
    }

    return Array.from(new Set(values));
}

function readRuns(
    runCount: number
): number[] {
    const all = Array.from(
        { length: runCount },
        (_: unknown, i: number) => i + 1
    );

    const raw = process.env.LUOT;

    if (!raw || !raw.trim()) {
        return all;
    }

    const chosen = new Set<number>();

    for (const part of raw.split(",")) {
        const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);

        if (!m) {
            throw new Error(`LUOT is invalid: "${raw}"`);
        }

        const from = Number(String(m[1]));
        const to = m[2] ? Number(String(m[2])) : from;

        for (let r = from; r <= to; r += 1) {
            if (r < 1 || r > runCount) {
                throw new Error(
                    `LUOT ${r} is outside 1..${runCount}`
                );
            }

            chosen.add(r);
        }
    }

    return all.filter((r: number) => chosen.has(r));
}

// =========================
// SEEDED SHUFFLE (mulberry32)
// =========================

function makeRng(
    seed: number
) {
    let a = seed >>> 0;

    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(
    items: T[],
    seed: number
): T[] {
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

// =========================
// MEASUREMENT ENVIRONMENT
// =========================

function gitInfo() {
    try {
        const commit = execSync(
            "git rev-parse HEAD",
            { cwd: PROJECT_ROOT, encoding: "utf8" }
        ).trim();

        const changed = execSync(
            "git status --porcelain",
            { cwd: PROJECT_ROOT, encoding: "utf8" }
        )
            .split(/\r?\n/)
            .filter(Boolean)
            .filter((line: string) => !line.includes("experiments/results/"));

        return {
            commit,
            so_tep_sua_ngoai_ket_qua: changed.length,
            tep_sua: changed.slice(0, 30)
        };
    } catch (error: any) {
        return {
            loi: String(error?.message || error)
        };
    }
}

function machineInfo() {
    const cpu = os.cpus();

    return {
        cpu: cpu[0] ? cpu[0].model : "",
        so_luong_cpu: cpu.length,
        ram_gb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
        he_dieu_hanh: `${os.platform()} ${os.release()}`,
        node: process.version
    };
}

function proverInfo() {
    const file = getProverPath();
    const content = fs.readFileSync(file);

    return {
        duong_dan: path.relative(PROJECT_ROOT, file),
        kich_thuoc: content.length,
        sua_luc: fs.statSync(file).mtime.toISOString(),
        sha256: crypto.createHash("sha256").update(content).digest("hex")
    };
}

/*
 * Reject an OLD prover: a binary built before lap20 knows neither `HALO2_K`
 * nor `check-k`. Running with it makes theo_d silently measure d = 9 all the
 * way through.
 */
function assertProverRebuilt() {
    const content = fs.readFileSync(getProverPath());

    if (
        !content.includes("check-k")
        || !content.includes("HALO2_K")
        || !content.includes("MERKLE_DEPTH")
    ) {
        throw new Error(
            "prover.exe has not been rebuilt since lap20 (no check-k mode /"
            + " no HALO2_K variable). Run: cargo build --release -p prover"
        );
    }
}

// =========================
// DEPTH AND K
// =========================

function setCircuitEnv(
    d: number,
    k: number
) {
    process.env.MERKLE_DEPTH = String(d);
    process.env.HALO2_K = String(k);
}

function clearCircuitEnv() {
    delete process.env.MERKLE_DEPTH;
    delete process.env.HALO2_K;
}

/*
 * The smallest K for depth d — the EXACT test that picked K = 9 at d = 9
 * (generate_proof.rs): walk K upwards, and the first K that passes keygen_vk
 * is the smallest one. K − 1 is confirmed to run out of rows as well, so
 * "smallest" is a measurement rather than an inference. The result is stored
 * in theo_d/dD/k.json and reused.
 */
function findSmallestK(
    d: number
): any {
    const file = path.join(RESULTS_ROOT, "theo_d", `d${d}`, "k.json");

    if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }

    const attempts: any[] = [];
    let found = -1;

    /*
     * Probe BOTTOM-UP: the first K that passes `keygen_vk` is the smallest,
     * and every smaller K has been tried and failed — which is what makes
     * "smallest" a measurement instead of an inference.
     */
    for (let k = K_PROBE_MIN; k <= K_PROBE_MAX; k += 1) {
        setCircuitEnv(d, k);

        try {
            const result = runRust("check-k", {});
            attempts.push({ k, du_hang: true, check_ms: result.check_ms });
            found = k;
            break;
        } catch (_error) {
            attempts.push({ k, du_hang: false });
        }
    }

    clearCircuitEnv();

    if (found < 0) {
        throw new Error(
            `No K ≤ ${K_PROBE_MAX} has enough rows for d = ${d}`
        );
    }

    if (found === K_PROBE_MIN) {
        console.log(
            `  ⚠️ d = ${d}: K = ${found} is the bottom of the probed range,`
            + " so K − 1 was never checked. Lower K_PROBE_MIN if needed."
        );
    }

    const result = {
        d,
        k_toi_thieu: found,
        k_thieu_hang: found - 1,
        phep_thu: "keygen_vk tren mach rong witness (mode check-k)",
        cac_lan_thu: attempts,
        do_luc: new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2));

    return result;
}

// =========================
// DATASET
// =========================

function loadDataset(
    cfg: Config
): any {
    if (cfg.experiment === "theo_n") {
        const ds = readDataset(cfg.n);

        if (!Array.isArray(ds.students) || ds.students.length !== cfg.n) {
            throw new Error(
                `dataset_n${cfg.n}.json does not hold exactly ${cfg.n} students`
            );
        }

        if (Number(ds.merkle_depth) !== DEFAULT_DEPTH) {
            throw new Error(
                `dataset_n${cfg.n}.json says merkle_depth = ${ds.merkle_depth}, expected ${DEFAULT_DEPTH}`
            );
        }

        return ds;
    }

    if (cfg.n > 2 ** cfg.d) {
        throw new Error(
            `n = ${cfg.n} exceeds the 2^${cfg.d} capacity of the tree`
        );
    }

    /*
     * theo_d — take the FIRST `n` students of `dataset_n500`. No new data is
     * generated: `rho`, wallets and notes stay byte-for-byte the same, so the
     * depth experiment and the scenario experiment talk about the same
     * students.
     *
     * The ADV prover reads the depth from the `MERKLE_DEPTH` variable, not
     * from the file; the `merkle_depth` field here is only a matching label.
     */
    const source = readDataset(SOURCE_N);

    if (!Array.isArray(source.students) || source.students.length < cfg.n) {
        throw new Error(
            `dataset_n${SOURCE_N}.json does not hold ${cfg.n} students`
        );
    }

    return {
        ...source,
        n: cfg.n,
        merkle_depth: cfg.d,
        students: source.students.slice(0, cfg.n)
    };
}

// =========================
// ONE RUN
// =========================

function runDirName(
    run: number
) {
    return `luot${String(run).padStart(2, "0")}`;
}

async function runOnce(
    cfg: Config,
    run: number,
    k: number,
    school: string,
    warmupCount: number
): Promise<boolean> {
    const dir = path.join(RESULTS_ROOT, cfg.experiment, cfg.name, runDirName(run));
    const doneFile = path.join(dir, "xong.json");

    if (fs.existsSync(doneFile)) {
        console.log(
            `SKIP ${cfg.experiment}/${cfg.name}/${runDirName(run)} — already finished`
        );
        return false;
    }

    // Unfinished run from an earlier session: wipe it and start over.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    setCircuitEnv(cfg.d, k);

    const dataset = loadDataset(cfg);
    const startedAt = new Date();
    const t0 = performance.now();

    console.log(
        `\n###### ${cfg.experiment} ${cfg.name} — ${runDirName(run)}`
        + ` (n = ${cfg.n}, d = ${cfg.d}, K = ${k}, warm-up ${warmupCount})`
    );

    const snapshotId = await callRpc("evm_snapshot");

    if (!snapshotId) {
        throw new Error(
            "Ganache returned no snapshot id before the run — stopping."
        );
    }

    let result: any;

    try {
        result = await chayMotKichBan(
            cfg.n,
            school,
            {
                dataset,
                soWarmup: warmupCount,
                ghiTepVaoResultDir: false,
                cheDoNong: CHE_DO_NONG
            }
        );
    } finally {
        const reverted = await callRpc("evm_revert", [snapshotId]);

        if (reverted !== true) {
            throw new Error(
                `evm_revert returned ${JSON.stringify(reverted)} after the run`
                + " — the chain was not cleaned up, stopping."
            );
        }
    }

    const expectedRows = warmupCount + cfg.n;

    if (
        result.dongHieuNang.length !== expectedRows
        || result.dongGas.length !== expectedRows
    ) {
        throw new Error(
            `Run ${runDirName(run)} of ${cfg.name}: expected ${expectedRows} rows,`
            + ` got ${result.dongHieuNang.length} performance`
            + ` / ${result.dongGas.length} gas`
        );
    }

    const PREFIX = "thi_nghiem,run_id,iteration,warmup,d,k,";

    const writeCsv = (
        name: string,
        header: string,
        rows: MeasuredRow[]
    ) => {
        fs.writeFileSync(
            path.join(dir, name),
            PREFIX + header
            + rows
                .map((x: MeasuredRow) => [
                    cfg.experiment,
                    run,
                    x.lan,
                    x.warmup,
                    cfg.d,
                    k,
                    x.dong
                ].join(","))
                .join("\n")
            + "\n"
        );
    };

    writeCsv(`performance_${MECHANISM}.csv`, CSV_HIEU_NANG_HEADER, result.dongHieuNang);
    writeCsv(`gas_${MECHANISM}.csv`, CSV_GAS_HEADER, result.dongGas);

    fs.writeFileSync(
        path.join(dir, "proofs.json"),
        JSON.stringify(result.proofs, null, 2)
    );

    // Written LAST — only this file marks the run as finished.
    fs.writeFileSync(
        doneFile,
        JSON.stringify({
            mechanism: MECHANISM,
            thi_nghiem: cfg.experiment,
            cau_hinh: cfg.name,
            run_id: run,
            n: cfg.n,
            d: cfg.d,
            k,
            warmup: warmupCount,
            so_lan_do: cfg.n,
            che_do: CHE_DO,
            tien_trinh: CHE_DO_NONG
                ? "mot tien trinh prove-batch cho ca luot: keygen 1 lan, warm-up, roi n proof, verify trong cung tien trinh"
                : "moi proof va moi lan verify la mot tien trinh prover moi",
            bat_dau: startedAt.toISOString(),
            ket_thuc: new Date().toISOString(),
            thoi_gian_ms: Number((performance.now() - t0).toFixed(1))
        }, null, 2)
    );

    return true;
}

// =========================
// MAIN
// =========================

async function main() {
    const experiment = String(process.env.THI_NGHIEM || "").trim();

    if (experiment !== "theo_n" && experiment !== "theo_d") {
        throw new Error(
            "Set THI_NGHIEM=theo_n or THI_NGHIEM=theo_d"
        );
    }

    const runCount = readInt("SO_LUOT", 20, 1, 100);
    const warmupCount = readInt("WARMUP", 3, 0, 20);
    const seed = readInt("HAT_GIONG", 20260915, 0, 2147483647);
    const runsToDo = readRuns(runCount);

    let configs: Config[];

    if (experiment === "theo_n") {
        configs = readList(
            "KICH_BAN",
            [1, 10, 30, 60, 100, 500],
            (x: number) => [1, 10, 30, 60, 100, 353, 500].includes(x)
        ).map((n: number): Config => ({
            experiment: "theo_n",
            name: `n${n}`,
            n,
            d: DEFAULT_DEPTH
        }));
    } else {
        /*
         * By default the tree is FILLED UP: n = 2^d (d = 1 → 8 means 2 → 256
         * students). Setting N_THEO_D switches to a fixed n for every d.
         */
        const fixedN = process.env.N_THEO_D
            ? readInt("N_THEO_D", 30, 1, SOURCE_N)
            : 0;

        configs = readList(
            "DO_SAU",
            [1, 2, 3, 4, 5, 6, 7, 8],
            (x: number) => x >= 1 && x <= 20
        ).map((d: number): Config => ({
            experiment: "theo_d",
            name: `d${d}`,
            n: fixedN > 0 ? fixedN : 2 ** d,
            d
        }));

        const tooBig = configs.filter((c: Config) => c.n > SOURCE_N);

        if (tooBig.length > 0) {
            throw new Error(
                `${tooBig[0]?.name} needs ${tooBig[0]?.n} students but the source dataset`
                + ` only holds ${SOURCE_N}. Drop that d from DO_SAU.`
            );
        }
    }

    const order = runsToDo.map((run: number) => ({
        luot: run,
        cau_hinh: shuffle(configs, seed + run).map((c: Config) => c.name)
    }));

    const totalMeasurements = runsToDo.length
        * configs.reduce((s: number, c: Config) => s + c.n, 0);

    console.log(
        `LAP20 — ${MECHANISM} branch — ${experiment}`
        + `  [mode: ${CHE_DO}${CHE_DO_NONG ? " — one prover process per run" : " — one prover process per proof"}]`
    );
    console.log(`  configurations : ${configs.map((c: Config) => c.name).join(", ")}`);
    console.log(`  runs           : ${runsToDo.join(", ")} (out of ${runCount})`);
    console.log(`  warm-up        : ${warmupCount} per run`);
    console.log(`  measurements   : ${totalMeasurements} (warm-up excluded)`);
    console.log(`  results        : ${path.relative(PROJECT_ROOT, RESULTS_ROOT)}`);
    order.slice(0, 3).forEach((o: any) =>
        console.log(`  order ${runDirName(o.luot)}: ${o.cau_hinh.join(" → ")}`)
    );

    if (process.env.CHI_IN_KE_HOACH === "1") {
        console.log("\nCHI_IN_KE_HOACH=1 — nothing else is run.");
        return;
    }

    assertProverRebuilt();

    const accounts: string[] = await web3.eth.getAccounts();
    const school = accounts[0];

    if (!school) {
        throw new Error("Ganache has no accounts");
    }

    const addresses = Array.from(
        new Set(
            configs.flatMap((c: Config) =>
                loadDataset(c).students.map((student: any) => student.address)
            )
        )
    ) as string[];

    await assertMeasurementEnvironment(addresses);

    const kByConfig = new Map<string, number>();
    const kDetails: any[] = [];

    for (const c of configs) {
        if (c.experiment === "theo_d") {
            const found = findSmallestK(c.d);
            kByConfig.set(c.name, found.k_toi_thieu);
            kDetails.push(found);
            console.log(`  d = ${c.d}: smallest K = ${found.k_toi_thieu}`);
        } else {
            kByConfig.set(c.name, DEFAULT_K);
        }
    }

    fs.mkdirSync(path.join(RESULTS_ROOT, experiment), { recursive: true });

    const configFile = path.join(RESULTS_ROOT, "cau_hinh_chay.json");
    const store = fs.existsSync(configFile)
        ? JSON.parse(fs.readFileSync(configFile, "utf8"))
        : {};

    const entry = store[experiment] || {};

    entry.mechanism = MECHANISM;
    entry.so_luot = runCount;
    entry.warmup = warmupCount;
    entry.hat_giong = seed;
    entry.che_do = CHE_DO;
    entry.cau_hinh = configs;
    entry.k_theo_cau_hinh = Object.fromEntries(kByConfig);
    entry.tim_k = kDetails;
    entry.dinh_nghia_luot = "mot luot = snapshot chuoi → warm-up → n lan do → revert;"
        + (CHE_DO_NONG
            ? " MOT tien trinh prove-batch cho ca luot (keygen 1 lan, verify trong cung tien trinh)"
            : " moi proof/verify la mot tien trinh prover moi")
        + "; thu tu cau hinh xao moi vong";
    entry.lan_khoi_chay = (entry.lan_khoi_chay || []).concat([{
        bat_dau: new Date().toISOString(),
        luot_chon: runsToDo,
        thu_tu: order,
        may: machineInfo(),
        git: gitInfo(),
        prover: proverInfo()
    }]);

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
        `\nLAP20 ${experiment} finished: ${ranCount} runs done, ${skippedCount} skipped,`
        + ` ${((performance.now() - tStart) / 60000).toFixed(1)} minutes.`
    );
    console.log("Mean ± SD summary: npm run experiment:lap20:tonghop");
}

main().catch(
    (error: any) => {
        console.error(error);
        process.exit(1);
    }
);
