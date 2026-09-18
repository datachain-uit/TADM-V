/*
 * LAP20 — QUANTITATIVE EXPERIMENT, 20 INDEPENDENT RUNS — ON-CHAIN BRANCH (ONC)
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
 *   1. A NEW `prover bench-from-dataset` process: params loading + keygen run
 *      ONCE for the run (so setup_ms is one value per run), then WARMUP
 *      warm-up proofs, then the n measured proofs. Proofs are produced inside
 *      that process — like the 12/09 lot, only with a warm-up and split into
 *      runs.
 *   2. The Ganache chain is snapshotted, gas is measured through `doMotKichBan`
 *      of benchmarkGas.ts ITSELF (deploy verifier + pool, approve the root,
 *      WARMUP warm-up iterations each in its own snapshot, then n measured
 *      iterations), and the chain is reverted.
 * Order: rounds r = 1..R; inside each round the configurations are SHUFFLED
 * with a fixed seed — so machine drift over time does not pile up on one
 * configuration.
 *
 * theo_d: BEFORE the runs, a Halo2Verifier is exported and compiled for each
 * d and its artifact is stored under theo_d/dD/; Halo2Verifier.sol is then put
 * BACK to the git HEAD version (d = 9), recompiled, and its bytecode checked
 * against the old one. The runs deploy from the stored artifacts, so the
 * depths can be interleaved without recompiling.
 *
 * Results: <RESULTS_ROOT>/<experiment>/<nN|dD>/luotNN/
 *   performance_onchain.csv · gas_onchain.csv · proofs.json · prover.log · xong.json
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
 * target/release/prover.exe built AFTER lap20 (it must understand
 * BENCH_OUT_DIR), and contracts already built with `npm run compile`. No
 * MongoDB, no IPFS. Do NOT run at the same time as the ADV branch (shared
 * Ganache).
 */
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execSync } = require("child_process");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

const {
    proverBinary
} = require("../clients/prover/halo2ProverClient");

const {
    doMotKichBan,
    assertMeasurementEnvironment,
    callRpc,
    CSV_HEADER
} = require("./benchmarkGas");

const MECHANISM = "onchain";

const web3 =
    new Web3(
        "http://127.0.0.1:8545"
    );

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const DATA_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/data"
    );

const RESULTS_ROOT =
    path.resolve(
        PROJECT_ROOT,
        process.env.THU_MUC_LAP
        || "experiments/results/quantitative/lap20_1509"
    );

const CONTRACTS_DIR =
    path.resolve(
        PROJECT_ROOT,
        "contracts"
    );

const VERIFIER_SOL =
    path.resolve(
        CONTRACTS_DIR,
        "contracts/Halo2Verifier.sol"
    );

const VERIFIER_ARTIFACT_PATH =
    path.resolve(
        CONTRACTS_DIR,
        "artifacts/contracts/Halo2Verifier.sol/Halo2Verifier.json"
    );

const DEFAULT_DEPTH = 9;

/*
 * The default K of this branch (used by theo_n and by every earlier lot).
 *
 * LAP20, 2026-09-16: the depth experiment LOOKS FOR THE SMALLEST K of each d,
 * like ADV does. A small tree (d < 9) fits in a K below 13. K travels through
 * the `HALO2_K` variable, and IT is what decides the circuit's `use_k` as well
 * as the size of the KZG params (circuits::circuit::k_mach).
 */
const DEFAULT_K = 13;

/*
 * The K range probed when looking for the smallest K. The probe goes
 * BOTTOM-UP, so the first K that passes is the smallest one and every smaller
 * K has been tried and failed.
 */
const K_PROBE_MIN = 6;
const K_PROBE_MAX = 16;

/*
 * Source dataset of the depth experiment: the FIRST `n` students of
 * `dataset_n500.json` — the same students already used by the scenario
 * experiment.
 */
const SOURCE_N = 500;

const EIP170_BYTES = 24576;

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
    const file = proverBinary();
    const content = fs.readFileSync(file);

    return {
        duong_dan: path.relative(PROJECT_ROOT, file),
        kich_thuoc: content.length,
        sua_luc: fs.statSync(file).mtime.toISOString(),
        sha256: crypto.createHash("sha256").update(content).digest("hex")
    };
}

/*
 * Reject an OLD prover: a binary built before lap20 does NOT know
 * BENCH_OUT_DIR, so it writes straight into
 * experiments/results/quantitative/ — overwriting the proofs_n*.json that the
 * hardhat tests, recordArtifactSizes and the multipool runners read. Check
 * first.
 */
function assertProverRebuilt() {
    const content = fs.readFileSync(proverBinary());

    if (
        !content.includes("BENCH_OUT_DIR")
        || !content.includes("BENCH_WARMUP")
    ) {
        throw new Error(
            "prover.exe has not been rebuilt since lap20 (it does not understand"
            + " BENCH_OUT_DIR). Run: cargo build --release -p prover"
        );
    }
}

function normalizeEol(
    s: string
) {
    return s.replace(/\r\n/g, "\n");
}

/*
 * The Halo2Verifier.sol on disk MUST be the git HEAD version (d = 9), and its
 * artifact must exist. A theo_d run killed midway can leave the verifier of a
 * different d behind — resuming on top of that would measure theo_n gas
 * against a verifier built for the wrong depth.
 */
function assertVerifierIsHeadVersion() {
    let head: string;

    try {
        head = execSync(
            "git show HEAD:./contracts/contracts/Halo2Verifier.sol",
            { cwd: PROJECT_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
        );
    } catch (error: any) {
        throw new Error(
            "Could not read Halo2Verifier.sol from git HEAD: "
            + String(error?.message || error)
        );
    }

    const onDisk = fs.readFileSync(VERIFIER_SOL, "utf8");

    if (normalizeEol(head) !== normalizeEol(onDisk)) {
        throw new Error(
            "contracts/contracts/Halo2Verifier.sol DIFFERS from the git HEAD version (d = 9)."
            + " A theo_d run stopped midway can cause this. Restore it with:"
            + " git checkout -- contracts/contracts/Halo2Verifier.sol"
            + " then `npm run compile` inside contracts/."
        );
    }

    if (!fs.existsSync(VERIFIER_ARTIFACT_PATH)) {
        throw new Error(
            "Halo2Verifier artifact missing — run `npm run compile` inside contracts/"
        );
    }
}

// =========================
// DATASET
// =========================

function datasetPathOf(
    cfg: Config
): string {
    const file = path.join(DATA_DIR, `dataset_n${cfg.n}.json`);

    if (!fs.existsSync(file)) {
        throw new Error(`Dataset missing: ${file}`);
    }

    const ds = JSON.parse(fs.readFileSync(file, "utf8"));

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

    return file;
}

/*
 * theo_d — take the FIRST `n` students of `dataset_n500` and set
 * `merkle_depth = d`.
 *
 * The ONC prover reads the depth from the `merkle_depth` field OF THE FILE
 * (inputs_builder.rs build_experiment_tree), so a separate file has to be
 * written. No new data is generated: `rho`, wallets and notes stay
 * byte-for-byte the same, so the depth experiment and the scenario experiment
 * talk about the same students.
 */
function datasetPathForDepth(
    cfg: Config
): string {
    if (cfg.n > 2 ** cfg.d) {
        throw new Error(
            `n = ${cfg.n} exceeds the 2^${cfg.d} capacity of the tree`
        );
    }

    const dir = path.join(RESULTS_ROOT, "theo_d", cfg.name);
    const file = path.join(dir, `dataset_n${cfg.n}_d${cfg.d}.json`);

    if (!fs.existsSync(file)) {
        const sourceFile = path.join(DATA_DIR, `dataset_n${SOURCE_N}.json`);
        const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));

        if (!Array.isArray(source.students) || source.students.length < cfg.n) {
            throw new Error(
                `dataset_n${SOURCE_N}.json does not hold ${cfg.n} students`
            );
        }

        source.n = cfg.n;
        source.merkle_depth = cfg.d;
        source.students = source.students.slice(0, cfg.n);

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(source, null, 2));
    }

    return file;
}

/*
 * The smallest K for depth d — the same test that picked K at d = 9: keygen_vk
 * on a sample circuit, and the prover exits non-zero when it runs out of rows
 * (the `check-k` mode).
 *
 * 🔴 THIS IS ONLY A LOWER BOUND, NOT THE K THAT WILL BE USED. halo2-base
 * widens the circuit by ADDING COLUMNS when K is small, and every extra column
 * INFLATES THE VERIFIER: measured on 2026-09-16 at d = 1, K = 10 has enough
 * rows but its verifier is 31,110 B, over EIP-170 (24,576 B), so it cannot be
 * deployed. The K actually used is picked by `prepareVerifiersForDepth`: the
 * smallest K whose verifier IS STILL DEPLOYABLE (see verifier.json, field `k`).
 *
 * The result is stored in theo_d/dD/k.json and reused.
 */
function findSmallestK(
    cfg: Config
): any {
    const file = path.join(RESULTS_ROOT, "theo_d", cfg.name, "k.json");

    if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }

    const dataset = datasetPathForDepth(cfg);
    const attempts: any[] = [];
    let found = -1;

    for (let k = K_PROBE_MIN; k <= K_PROBE_MAX; k += 1) {
        const probe = spawnSync(
            proverBinary(),
            ["check-k", dataset],
            {
                cwd: path.join(PROJECT_ROOT, "prover"),
                encoding: "utf8",
                env: { ...process.env, HALO2_K: String(k) }
            }
        );

        if (probe.status === 0) {
            attempts.push({ k, du_hang: true });
            found = k;
            break;
        }

        attempts.push({ k, du_hang: false });
    }

    if (found < 0) {
        throw new Error(
            `No K ≤ ${K_PROBE_MAX} has enough rows for d = ${cfg.d}`
        );
    }

    if (found === K_PROBE_MIN) {
        console.log(
            `  ⚠️ d = ${cfg.d}: K = ${found} is the bottom of the probed range,`
            + " so K − 1 was never checked."
        );
    }

    const result = {
        d: cfg.d,
        n: cfg.n,
        k_toi_thieu: found,
        k_thieu_hang: found - 1,
        phep_thu: "keygen_vk tren mach mau (mode check-k)",
        cac_lan_thu: attempts,
        do_luc: new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2));

    return result;
}

function verifierArtifactPathForDepth(
    d: number
) {
    return path.join(RESULTS_ROOT, "theo_d", `d${d}`, "Halo2Verifier.artifact.json");
}

// =========================
// EXTERNAL COMMANDS
// =========================

function runCommand(
    command: string,
    args: string[],
    options: any,
    description: string
) {
    const result = spawnSync(command, args, { encoding: "utf8", ...options });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`${description} failed (exit code ${result.status})`);
    }

    return result;
}

function compileContracts(
    description: string
) {
    runCommand(
        "npx",
        ["hardhat", "compile"],
        { cwd: CONTRACTS_DIR, stdio: "inherit", shell: true },
        description
    );
}

/*
 * Prepare a verifier for every d of theo_d, AND PICK THE K TO USE.
 *
 * 🔴 K is not simply "the smallest with enough rows". halo2-base makes up for
 * missing rows by ADDING COLUMNS, and every column inflates the verifier —
 * measured on 2026-09-16:
 *
 *     d = 1, K = 10 (smallest with enough rows)  ->  verifier 31,110 B  ->  OVER EIP-170
 *
 * So the criterion is: **the smallest K whose verifier is STILL DEPLOYABLE**
 * (bytecode ≤ 24,576 B). That is the real constraint of the on-chain branch,
 * and also the reason the older lots ran at K = 13 rather than 11. This
 * function probes upwards from k_toi_thieu, exporting + compiling + measuring
 * the bytecode each time, and takes the first K that fits EIP-170.
 *
 * The artifact is written LAST — only that file marks a depth as prepared. The
 * `finally` block ALWAYS puts Halo2Verifier.sol back to the d = 9 version and
 * recompiles, even when one depth fails.
 */
function prepareVerifiersForDepth(
    configs: Config[],
    kLowerBound: Map<string, number>,
    kByConfig: Map<string, number>
) {
    for (const c of configs) {
        const verifierFile = path.join(RESULTS_ROOT, "theo_d", c.name, "verifier.json");

        if (fs.existsSync(verifierArtifactPathForDepth(c.d)) && fs.existsSync(verifierFile)) {
            const v = JSON.parse(fs.readFileSync(verifierFile, "utf8"));
            kByConfig.set(c.name, Number(v.k));
        }
    }

    const todo = configs.filter(
        (c: Config) => !kByConfig.has(c.name)
    );

    if (todo.length === 0) {
        console.log("  every depth already has its verifier — export step skipped.");
        return;
    }

    const originalSol = fs.readFileSync(VERIFIER_SOL, "utf8");
    const originalArtifact = JSON.parse(fs.readFileSync(VERIFIER_ARTIFACT_PATH, "utf8"));

    try {
        for (const c of todo) {
            const dataset = datasetPathForDepth(c);
            const dir = path.dirname(dataset);
            const from = kLowerBound.get(c.name) as number;
            const attempts: any[] = [];
            let chosenK = -1;
            let chosenBytes = -1;

            for (let k = from; k <= K_PROBE_MAX; k += 1) {
                console.log(`\n=== Exporting Halo2Verifier for d = ${c.d}, trying K = ${k} ===`);

                // The verifier must be generated at the K used for measuring — a
                // different K makes every proof be rejected.
                runCommand(
                    proverBinary(),
                    ["export-verifier-from-dataset", dataset],
                    {
                        cwd: path.join(PROJECT_ROOT, "prover"),
                        stdio: "inherit",
                        env: { ...process.env, HALO2_K: String(k) }
                    },
                    `export-verifier-from-dataset d = ${c.d}, K = ${k}`
                );

                compileContracts(`hardhat compile d = ${c.d}, K = ${k}`);

                const artifact = JSON.parse(fs.readFileSync(VERIFIER_ARTIFACT_PATH, "utf8"));
                const bytes = (String(artifact.deployedBytecode).length - 2) / 2;

                attempts.push({
                    k,
                    deployed_bytecode_bytes: bytes,
                    lot_eip170: bytes <= EIP170_BYTES
                });

                console.log(
                    `  d = ${c.d}, K = ${k}: verifier ${bytes} B`
                    + (bytes <= EIP170_BYTES ? " — FITS EIP-170" : " — over EIP-170")
                );

                if (bytes > EIP170_BYTES) {
                    continue;
                }

                chosenK = k;
                chosenBytes = bytes;

                fs.copyFileSync(VERIFIER_SOL, path.join(dir, "Halo2Verifier.sol"));

                fs.writeFileSync(
                    path.join(dir, "verifier.json"),
                    JSON.stringify({
                        d: c.d,
                        n: c.n,
                        k: chosenK,
                        k_toi_thieu_du_hang: from,
                        tieu_chi: "K nho nhat ma verifier deploy duoc (bytecode ≤ EIP-170)",
                        deployed_bytecode_bytes: chosenBytes,
                        eip170_pct: Number((100 * chosenBytes / EIP170_BYTES).toFixed(2)),
                        sol_bytes: fs.statSync(VERIFIER_SOL).size,
                        cac_lan_thu: attempts,
                        xuat_luc: new Date().toISOString()
                    }, null, 2)
                );

                fs.writeFileSync(
                    verifierArtifactPathForDepth(c.d),
                    JSON.stringify({
                        contractName: artifact.contractName,
                        abi: artifact.abi,
                        bytecode: artifact.bytecode,
                        deployedBytecode: artifact.deployedBytecode
                    })
                );

                break;
            }

            if (chosenK < 0) {
                throw new Error(
                    `d = ${c.d}: no K ≤ ${K_PROBE_MAX} produces a verifier that fits`
                    + ` EIP-170. Smallest measured: `
                    + `${Math.min(...attempts.map((a: any) => a.deployed_bytecode_bytes))} B.`
                );
            }

            kByConfig.set(c.name, chosenK);
            console.log(`  => d = ${c.d} uses K = ${chosenK} (verifier ${chosenBytes} B)`);
        }
    } finally {
        console.log("\n=== Restoring Halo2Verifier.sol to the d = 9 version and recompiling ===");

        fs.writeFileSync(VERIFIER_SOL, originalSol);
        compileContracts("hardhat compile (restore d = 9)");

        const artifactAfter = JSON.parse(fs.readFileSync(VERIFIER_ARTIFACT_PATH, "utf8"));

        if (artifactAfter.deployedBytecode !== originalArtifact.deployedBytecode) {
            throw new Error(
                "The Halo2Verifier artifact after the restore DIFFERS from the previous one —"
                + " check contracts/ by hand before running anything else."
            );
        }

        console.log("  restored — bytecode matches the previous one.");
    }
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
    accounts: string[],
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

    const dataset =
        cfg.experiment === "theo_d"
            ? datasetPathForDepth(cfg)
            : datasetPathOf(cfg);

    const verifierArtifact =
        cfg.experiment === "theo_d"
            ? JSON.parse(fs.readFileSync(verifierArtifactPathForDepth(cfg.d), "utf8"))
            : undefined;

    const startedAt = new Date();
    const t0 = performance.now();

    console.log(
        `\n###### ${cfg.experiment} ${cfg.name} — ${runDirName(run)}`
        + ` (n = ${cfg.n}, d = ${cfg.d}, K = ${k}, warm-up ${warmupCount})`
    );

    // -------------------------
    // 1. Proof generation — ONE new prover process for the whole run
    // -------------------------

    const logFile = path.join(dir, "prover.log");
    const logFd = fs.openSync(logFile, "w");
    let prover: any;

    try {
        prover = spawnSync(
            proverBinary(),
            ["bench-from-dataset", dataset],
            {
                cwd: path.join(PROJECT_ROOT, "prover"),
                stdio: ["ignore", logFd, logFd],
                env: {
                    ...process.env,
                    BENCH_OUT_DIR: dir,
                    BENCH_WARMUP: String(warmupCount),
                    HALO2_K: String(k)
                }
            }
        );
    } finally {
        fs.closeSync(logFd);
    }

    if (prover.error) {
        throw prover.error;
    }

    if (prover.status !== 0) {
        throw new Error(
            `bench-from-dataset failed (exit code ${prover.status}) — see ${logFile}`
        );
    }

    const proverPerfFile = path.join(dir, `performance_onchain_n${cfg.n}.csv`);
    const proverProofFile = path.join(dir, `proofs_n${cfg.n}.json`);

    const perfLines = fs
        .readFileSync(proverPerfFile, "utf8")
        .split(/\r?\n/)
        .filter((x: string) => x.length > 0);

    const perfHeader = perfLines[0] as string;
    const perfRows = perfLines.slice(1);

    if (perfRows.length !== warmupCount + cfg.n) {
        throw new Error(
            `performance ${cfg.name}/${runDirName(run)}: expected ${warmupCount + cfg.n} rows, got ${perfRows.length}`
        );
    }

    const proofs = JSON.parse(fs.readFileSync(proverProofFile, "utf8"));

    if (!Array.isArray(proofs) || proofs.length !== cfg.n) {
        throw new Error(
            `proofs ${cfg.name}/${runDirName(run)}: expected ${cfg.n} proofs`
        );
    }

    // -------------------------
    // 2. Gas — one snapshot around the whole run
    // -------------------------

    const snapshotId = await callRpc("evm_snapshot");

    if (!snapshotId) {
        throw new Error(
            "Ganache returned no snapshot id before the run — stopping."
        );
    }

    let gasResult: any;

    try {
        gasResult = await doMotKichBan(
            cfg.n,
            proofs,
            school,
            accounts,
            verifierArtifact
                ? { verifierArtifact, soWarmup: warmupCount, datasetPath: dataset }
                : { soWarmup: warmupCount, datasetPath: dataset }
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

    if (gasResult.dong.length !== warmupCount + cfg.n) {
        throw new Error(
            `gas ${cfg.name}/${runDirName(run)}: expected ${warmupCount + cfg.n} rows, got ${gasResult.dong.length}`
        );
    }

    // -------------------------
    // 3. Writing the files of the run
    // -------------------------

    const PREFIX = "thi_nghiem,run_id,iteration,warmup,d,k,";

    /*
     * The prover writes the warm-up rows at the HEAD of the file, exactly
     * `warmupCount` of them — see experiment.rs. The iteration number and the
     * warmup flag follow that order.
     */
    fs.writeFileSync(
        path.join(dir, `performance_${MECHANISM}.csv`),
        PREFIX + perfHeader + "\n"
        + perfRows
            .map((row: string, i: number) => [
                cfg.experiment,
                run,
                i + 1,
                i < warmupCount,
                cfg.d,
                k,
                row
            ].join(","))
            .join("\n")
        + "\n"
    );

    fs.writeFileSync(
        path.join(dir, `gas_${MECHANISM}.csv`),
        PREFIX + CSV_HEADER
        + gasResult.dong
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

    fs.unlinkSync(proverPerfFile);
    fs.renameSync(proverProofFile, path.join(dir, "proofs.json"));

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
            calldata_bytes: proofs[0].calldata_bytes,
            proof_bytes: proofs[0].proof_bytes,
            tien_trinh: "mot tien trinh prover moi cho ca luot: keygen 1 lan, warm-up, roi n proof",
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

    console.log(`LAP20 — ${MECHANISM} branch — ${experiment}`);
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
    assertVerifierIsHeadVersion();

    const accounts: string[] = await web3.eth.getAccounts();
    const school = accounts[0];

    if (!school) {
        throw new Error("Ganache has no accounts");
    }

    const addresses = Array.from(
        new Set(
            configs.flatMap((c: Config) =>
                JSON.parse(
                    fs.readFileSync(
                        c.experiment === "theo_d"
                            ? datasetPathForDepth(c)
                            : datasetPathOf(c),
                        "utf8"
                    )
                ).students.map((student: any) => student.address)
            )
        )
    ) as string[];

    await assertMeasurementEnvironment(addresses);

    const kByConfig = new Map<string, number>();
    const kLowerBound = new Map<string, number>();
    const kDetails: any[] = [];

    if (experiment === "theo_d") {
        for (const c of configs) {
            const found = findSmallestK(c);
            kLowerBound.set(c.name, found.k_toi_thieu);
            kDetails.push(found);
            console.log(
                `  d = ${c.d} (n = ${c.n}): smallest K with enough rows = ${found.k_toi_thieu}`
                + " — the K actually used is picked by the verifier export step"
            );
        }

        prepareVerifiersForDepth(configs, kLowerBound, kByConfig);
    } else {
        for (const c of configs) {
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
    entry.k_theo_cau_hinh = Object.fromEntries(kByConfig);
    entry.k_toi_thieu_du_hang = Object.fromEntries(kLowerBound);
    entry.tieu_chi_chon_k = "K nho nhat ma verifier deploy duoc (bytecode ≤ EIP-170)";
    entry.tim_k = kDetails;
    entry.cau_hinh = configs;
    entry.dinh_nghia_luot = "mot luot = tien trinh prover moi (keygen 1 lan, warm-up, n proof)"
        + " → snapshot chuoi → deploy + duyet root + warm-up + n lan do gas → revert;"
        + " thu tu cau hinh xao moi vong";
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

    for (const o of order) {
        for (const name of o.cau_hinh) {
            const c = configs.find((x: Config) => x.name === name) as Config;
            const k = kByConfig.get(name) as number;

            if (await runOnce(c, o.luot, k, school, accounts, warmupCount)) {
                ranCount += 1;
            } else {
                skippedCount += 1;
            }
        }
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
