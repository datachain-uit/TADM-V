# TADM-V: A Trust-Aware Dual-Mode Verification Framework for Privacy-Preserving Scholarship Disbursement

Artifact: implementation and raw measurement data.

The protocol is: note → Poseidon commitment → Merkle tree → Halo2 membership proof → nullifier →
withdrawal. Public inputs, in order: `[root, nullifier, amount, recipient]`. Private witness:
`student_id`, `rho`, Merkle path.

| | Mode A | Mode B |
|---|---|---|
| Verification | off-chain, in the backend | on-chain, in `Halo2Verifier.sol` |
| Proof system | `halo2_proofs` 0.3.2, IPA / Pasta | `halo2-axiom` 0.5.1, KZG / BN254 |
| Contract call | `withdrawOffChain(root, nullifier, recipient, amount)` | `verifyAndRecord(proof, …)` + `settle(nullifier)` |
| `K` at `d = 9` | 9 | 13 |
| Proof size | 3 104 B | 4 224 B (calldata 4 352 B) |
| Per-mode guide | [`Mode A/README.md`](Mode%20A/README.md) | [`Mode B/README.md`](Mode%20B/README.md) |

`Groth16/` holds a baseline of the same relation as Mode B, proved with Groth16 (Circom + SnarkJS); its
guide is [`Groth16/README.md`](Groth16/README.md).

## 1. Layout

```
Mode A/ , Mode B/
├── circuits/              Halo2 circuit: circuit.rs, commitment.rs, merkle_tree.rs, note.rs, poseidon.rs
├── prover/                Rust CLI over the circuit; modes on argv, JSON on stdin/stdout
├── contracts/             ShieldedPool.sol (+ Halo2Verifier.sol in Mode B) and Hardhat tests
├── backend/               TypeScript backend, layered (see below)
│   ├── src/experiments/   the runners listed in §4
│   └── .env.example       copy to .env; .env.ganache.example / .env.sepolia.example are for the web server
├── admin-web/             web page of the Student Affairs Office and the Finance Office (port 3002)
├── client-web/            web page of the student (port 3000)
├── shared/params.bin      Mode A only: IPA parameters for K = 9
└── experiments/
    ├── data/              dataset_n{1,10,30,60,100,500}.json — inputs, shipped; built by Mode B's experiment:prepare
    └── results/
        ├── quantitative/repeated_runs/   20-run lot: the numbers in the paper
        ├── quantitative/report_run/      single-run lot, 12 Sep 2026: per-round totals
        ├── quantitative/artifact_sizes.json   bytecode sizes
        ├── qualitative/               qualitative criteria run, n = 500
        ├── anonymity/                 anonymity by amount tier and the wallet-reuse probe (added after the paper)
        └── sepolia/                   public-testnet validation

Groth16/                   baseline of the same relation, proved with Groth16; own package.json, chain on port 8546
```

Both modes read the same datasets: the six files are byte-identical between `Mode A/` and `Mode B/` in git
and in a checkout (git stores them with LF and `.gitattributes` keeps LF on checkout; SHA-256 equal for all six).

**Backend layout.** Both backends share one layout and the same file names: `config/` (environment file,
MongoDB connection) → `models/<entity>.model.ts` (Mongoose schemas) → `repositories/<entity>.repo.ts` (the only
files that import `models/`) → `services/<domain>.service.ts` (business logic). Two entry points call the
services: `cli/<domain>.cli.ts`, one per group of `npm run` commands, and the web server (`app.ts`, `server.ts`,
`routes/` → `middlewares/` + `validations/` → `controllers/`). `clients/` holds the outbound adapters —
`blockchain/` (Web3), `ipfs/` (IPFS daemon and note encryption), `prover/` (spawns the Rust binary) — and
`utils/` the shared helpers. `src/tests/layerBoundary.test.ts` checks that only repositories import models, that
services never import Express, and that routes, controllers and middlewares never import repositories or models.

**Code style.** TypeScript uses `import`/`export` and is formatted with Prettier (`npm run format:check` in
`backend/`); Rust is formatted with `rustfmt` (`rustfmt.toml` at each mode's root). Identifiers and messages are
English. The TypeScript and Rust sources carry no comments; the explanations are in these READMEs. The Rust
sources are `circuits/src/{circuit,commitment,merkle_tree,note,poseidon,lib}.rs` and
`prover/src/{main,lib,field,flow_inputs,generate_proof,experiment}.rs`, plus `export_verifier.rs` in Mode B.

## 2. Requirements

| | |
|---|---|
| Rust | 1.94.1 (pinned in `rust-toolchain.toml`) |
| Node.js | 20 LTS or 22 (measured on 22.13.0) |
| Ganache | 7.9.2 |
| IPFS (Kubo) | 0.41.0 — only for §5 and the qualitative runner |
| MongoDB | any instance — only for §5 and the qualitative runner. MongoDB Community (`winget install MongoDB.Server`, `brew install mongodb-community`, or the distribution package) installs a service on port 27017, which is what `.env.example` points at |
| Measured on | Windows 11, Intel Core i5-1135G7 (4C/8T), 7.7 GB RAM |

On Linux/macOS the Mode A backend still looks for `target/release/prover.exe`; copy or symlink the built
binary to that name. Mode B also accepts `PROVER_BIN=/path/to/prover`.

## 3. Setup

In `Mode A/`, then in `Mode B/` (quote the paths, they contain a space):

```bash
cargo build --release -p prover
cd contracts && npm ci && npm run compile && cd ..
cd backend   && npm ci && cp .env.example .env && cd ..
```

Ganache — the runners verify the mnemonic, and `n = 500` needs 501 accounts:

```bash
ganache --wallet.totalAccounts 501 --wallet.mnemonic "test test test test test test test test test test test junk"
```

Do not run the two modes at the same time; they share `accounts[0]`.

Checks:

```bash
cd backend    && npm run typecheck && npm test   # Mode A 61 tests, Mode B 63 tests
cd contracts  && npm test                        # Mode A 15 tests, Mode B 39 tests
cargo test --release --workspace --locked        # Mode A 8 tests, generates real proofs; Mode B 9 circuit tests
cd client-web && npm ci && npm test              # 12 tests (vitest), in each mode
```

These run without Ganache, IPFS or MongoDB, with `.env` left at its example values. Mode A's `cargo test` runs
5 circuit tests (a sixth, a timing benchmark, is `#[ignore]`d), `proof_smoke.rs` and the two `verify_gate.rs`
tests (see the Mode A README).

## 4. Reproducing the measurements

Three levels. Each writes to its own directory, so the published lot in `repeated_runs/` is never overwritten.
All paths are under `experiments/results/` inside `Mode A/` or `Mode B/`.

| | What it does | Time | Writes to |
|---|---|---|---|
| Level 1 | recompute the tables from the published runs | seconds | `quantitative/repeated_runs/` — rewrites the summary tables, whose numbers must come out unchanged |
| Level 2 | re-measure one configuration, `n = 10`, one run | minutes | `quantitative/check/` |
| Level 3 | re-measure everything, 20 runs per configuration | hours to days | Mode A `quantitative/repeated_runs_warm/`, Mode B `quantitative/repeated_runs_rerun/` |

To compare, open `<directory>/by_n/paper_table_by_n.csv` and the file of the same name in
`quantitative/repeated_runs/`, which holds the figures the paper reports.

### Level 1 — rebuild every table from the raw data (seconds, no services)

```bash
cd backend && npm run experiment:repeated:summary
```

Reads every run under `experiments/results/quantitative/repeated_runs/` and rewrites the `summary_*.csv` and
`paper_table_*.csv` files. Expected: every number is unchanged, and `git diff` shows one change only — the first
column, the experiment label, reads `by_n` / `by_depth` where the published tables say `theo_n` / `theo_d` (the
names in use when the lot was measured, see §7). The `per_run.csv` files come out byte-identical.
`git checkout -- experiments/results` restores the published tables.

### Level 2 — re-measure one configuration (minutes, Ganache)

Requires all of §3: without `cargo build` it fails on a missing `target/release/prover.exe`, without
`npm run compile` on `Cannot find module …/ShieldedPool.json`.

```bash
cd backend
EXPERIMENT=by_n ONLY_RUNS=1 SCENARIOS=10 RUNS_DIR=experiments/results/quantitative/check npm run experiment:repeated
RUNS_DIR=experiments/results/quantitative/check npm run experiment:repeated:summary
```

PowerShell: `$env:EXPERIMENT = "by_n"`, and so on. Output goes to `quantitative/check/`, which is
ignored by git, so the committed results stay untouched.

Compare `check/by_n/paper_table_by_n.csv` with row `n10` of
`repeated_runs/by_n/paper_table_by_n.csv`:

| Mode A, `n = 10` | published lot, 20 runs, N = 200 |
|---|---|
| `withdraw_gas` | 64 665 ± 5 |
| `proof_generation_ms` | 203.5 ± 18.4 |
| `verify_native_ms` | 7.1 ± 0.9 |
| `setup_ms` | 102.9 ± 12.1 |

| Mode B, `n = 10` | published lot, 20 runs, N = 200 |
|---|---|
| `tach_gas` | 685 269 ± 56 |
| `verify_record_gas` | 615 643 ± 56 |
| `settle_gas` | 69 626 ± 0 |
| `proof_generation_ms` | 1 229.3 ± 91.6 |
| `setup_ms` | 1 598.6 ± 122.2 |

A one-run check must land inside the gas spread above. Times are machine- and load-dependent.

### Level 3 — full re-run

```bash
cd backend

# Mode A — writes to quantitative/repeated_runs_warm/
PROVER_MODE=warm EXPERIMENT=by_n npm run experiment:repeated       # d = 9, n ∈ {1, 10, 30, 60, 100, 500}
PROVER_MODE=warm EXPERIMENT=by_depth npm run experiment:repeated   # d ∈ {1 … 8}, n = 2^d
RUNS_DIR=experiments/results/quantitative/repeated_runs_warm npm run experiment:repeated:summary

# Mode B — writes to quantitative/repeated_runs_rerun/
RUNS_DIR=experiments/results/quantitative/repeated_runs_rerun EXPERIMENT=by_n npm run experiment:repeated
RUNS_DIR=experiments/results/quantitative/repeated_runs_rerun EXPERIMENT=by_depth npm run experiment:repeated
RUNS_DIR=experiments/results/quantitative/repeated_runs_rerun npm run experiment:repeated:summary
```

The tables of the re-run are written next to its runs, in `repeated_runs_warm/` and `repeated_runs_rerun/`;
unlike `check/`, these directories are not ignored by git and show up as untracked files. The published lot in
`repeated_runs/` is not touched: it already holds 280 completed runs per mode, and completed runs are skipped.
That is why Mode B needs `RUNS_DIR`, and why Mode A without `PROVER_MODE=warm` (the default, `cold`, targets
`repeated_runs/`) skips everything.

Duration on the machine in §2 — `by_n`: Mode A ≈ 2 h, Mode B ≈ 27 h. `by_depth`: Mode A ≈ 1.5 h,
Mode B ≈ 24 h. Run Mode A and Mode B one after the other, never together.

Protocol of one run: Ganache snapshot → 3 warm-up iterations (`warmup = true`, excluded) → `n` measured
iterations → revert. 20 runs per configuration; the order of configurations is shuffled each round with
seed `20260915`. Reported values are mean ± sample SD over `N = 20 · n` iterations, except quantities that
are constant within a run (`update_root_gas`, deployment gas, Mode B `setup_ms`), counted once per run
(`N = 20`); the `cach_dem` column states which rule applies. `by_depth` fills the tree at each depth
(`n = 2^d`) and takes the first `n` students of `dataset_n500.json`; `d = 9` is not re-measured there, it is
the `n = 500` configuration of `by_n`. The rule for choosing `K` per depth differs between the modes —
see the per-mode README.

Other settings of `experiment:repeated`: `RUNS` (runs per configuration, default 20), `WARMUP` (default 3),
`SCENARIOS` (the `n` list of `by_n`), `DEPTHS` (the `d` list of `by_depth`, default `1,2,3,4,5,6,7,8`),
`N_PER_DEPTH` (a fixed `n` at every depth instead of `2^d`), `ONLY_RUNS` (e.g. `1` or `1-3`), `SEED`, `RUNS_DIR`,
and `PLAN_ONLY=1` (print the plan and exit). `experiment:repeated:summary` reads `RUNS_DIR` and `RUNS`.

To resume after a stop: restart Ganache, then rerun the same command. Runs holding `done.json` are skipped.

### Other runners

```bash
cd backend
npm run experiment:artifacts                               # → quantitative/artifact_sizes.json
cp experiment.config.example.json experiment.config.json   # fill in wallets from the Ganache mnemonic
npm run experiment:qualitative -- ./experiment.config.json # Ganache + IPFS + MongoDB
npm run experiment:anonymity -- ./anonymity.config.json   # Ganache + IPFS + MongoDB
npm run experiment:sepolia                                 # needs SEPOLIA_RPC_URL and a funded SEPOLIA_PRIVATE_KEY in .env
```

They write, respectively, `experiments/results/quantitative/artifact_sizes.json`; a new
`experiments/results/qualitative/qualitative[-onchain]-n<N>-<timestamp>.json` with six `.csv` beside it
(`-onchain` in Mode B only; see the per-mode README for the file list); `experiments/results/anonymity/`
(below); and `experiments/results/sepolia/validation_<network>.json` plus its `.csv` (fixed name, overwritten by the next run; the 12 Sep 2026 files keep their dated names).

**Anonymity runner.** It drives the real flow for every scenario in the config and then plays a chain observer
who knows every student's approved amount and reads only the `Withdraw` events. `anonymity.config.json` holds
three `n = 100` scenarios: one amount for everybody; three amount tiers (60 / 30 / 10 % of the students) with
`walletReuseProbe`; and one amount per student. Per scenario it writes
`anonymity_n<n>_{same-amount|tiers<k>|different-amount}.csv` (one row per withdrawal: anonymity set by amount,
by wallet, under collusion, by disbursement order) and `anonymity_summary.json` (with the anonymity set of each
tier). `walletReuseProbe: k` then opens a second pool, asks to register the first-pool wallet of `k` students
again plus one fresh wallet, and writes `wallet_reuse_n<n>.csv`. A scenario whose CSV already exists is skipped
unless `RERUN=1`; a second argument sets another output folder. `MONGODB_URI` must name a database containing
`anonymity`, `qualitative` or `experiment` — the runner resets it.

**Sepolia runner.** `experiment:sepolia` deploys a pool (Mode B: verifier + pool), approves the root of the
500-student dataset and withdraws for every student in `SEPOLIA_STUDENTS` (default `0-499`; e.g. `0-9` or
`0,250,499`), one after another, using the proofs of `quantitative/report_run/` unless `SEPOLIA_PROOFS` names
another proof file. Each run has a folder `sepolia/run_<network>/` with `state.json` (contracts and
setup receipts) and `withdrawals.jsonl` / `withdrawals.csv`, appended as each withdrawal confirms (gas, send and
receipt block, blocks waited, confirmation time). If it stops — out of funds, network error — rerun with
`SEPOLIA_RUN=<that folder>`: it reuses the pool, skips spent nullifiers and, in Mode B, settles a claim recorded
before the stop; a second fresh run refuses while that folder exists. The wallet balance is checked before every withdrawal. Optional: `SEPOLIA_PRIORITY_GWEI` (fixed
tip), `SEPOLIA_TX_TIMEOUT_MS` (default 600 000). Budget on 2026-10-21: about 168 000 gas per Mode A withdrawal and
about 1.07 million per Mode B withdrawal (`verifyAndRecord` + `settle`), so 500 + 500 withdrawals need about
630 million gas — 0.63 SepETH per gwei of gas price.

The qualitative runner with `"resetDatabase": true` only accepts a database whose name contains
`qualitative` or `experiment`. Its verdicts (`pass` / `partial` / `by_design_not_met`) must match
`experiments/results/qualitative/qualitative-*n500-2026-09-12T*`.

Our Sepolia run of 12 Sep 2026, verifiable on Etherscan:

| Contract | Address |
|---|---|
| Mode A `ShieldedPool` | `0xb5dB57aBc6e8F99907db4D7b7511a6A1F7BCaaC1` |
| Mode B `ShieldedPool` | `0xB222C4f161F486A1860a29BAF83f74F952115359` |
| Mode B `Halo2Verifier` | `0xf6D276CB65E3040719aF610bc771941C6715340D` |

`updateRoot` costs more there than on Ganache: Sepolia applies the EIP-7623 calldata floor.

## 5. End-to-end run

The measurement runners of §4 — Levels 1–3 and `experiment:artifacts` — drive the contracts directly and
never touch IPFS or MongoDB; `experiment:qualitative` needs both. The full protocol — issue a
note, encrypt it to IPFS, publish the root, decrypt, prove, withdraw, and have a replayed nullifier
rejected — is the command sequence in each per-mode README. It needs Ganache, IPFS and MongoDB, and writes
to the database, so point `MONGODB_URI` at a scratch database.

Proving is server-side, as in the paper (§4.3): the student decrypts the note and hands `{cid, note}` to the
university backend, which builds the witness and generates the proof. Mode A then verifies the proof off-chain;
Mode B submits it to `verifyAndRecord`. The student holds no spending key, and nothing is proved in the browser.

Two environment facts when scripting it:

- Every flow command prints one `JSON.stringify(…, null, 2)` object on stdout — a compact result, never a raw
  database document — and writes MongoDB connection lines and progress to stderr; it exits non-zero on
  failure, printing only the error message. Ids are `universityId`, `poolId`, and `id` for a withdrawal request.
- `withdrawal:create` reads its JSON from a file named as the argument, or from stdin; a leading byte-order
  mark is stripped. On Windows PowerShell 5.1 the simplest route is a file:

  ```powershell
  npm run note:decrypt -- <cid> <studentPrivateKey> note.json
  npm run withdrawal:create -- note.json
  ```

### Web pages

Each mode also ships the two pages of the system, `admin-web/` (Student Affairs Office and Finance Office,
port 3002) and `client-web/` (student, port 3000); the per-mode README lists their checks. Both proxy `/api`
to the backend's web server on port 3001:

```bash
cd backend
cp .env.ganache.example .env.ganache          # names only; fill in the values (MongoDB, RPC, IPFS, port 3001)
NETWORK=ganache npm run api:start             # NETWORK=sepolia reads .env.sepolia instead
cd ../admin-web  && npm ci && npm run dev
cd ../client-web && npm ci && npm run dev
```

The server refuses a database whose name contains `qualitative` or `experiment` and checks the RPC chain id
(1337 for `ganache`, 11155111 for `sepolia`). The university and its two staff accounts are created with the
CLI (`university:create`); staff sign in with a password set by `npm run staff:password`. Students sign in with
a temporary password set by Student Affairs (`npm run student:password`, changed at first login), generate their
note key pair in the browser, and hand the wallet address and note public key to Student Affairs, who register
them (web form or `npm run student:wallet`). To withdraw, the student page downloads the encrypted note,
decrypts it in the browser and submits `{cid, note}`.

## 6. Which file holds which result

| Paper result | Runner | File |
|---|---|---|
| Gas and time vs. pool size `n` | `experiment:repeated` (`by_n`) | `quantitative/repeated_runs/by_n/paper_table_by_n.csv`; full statistics in `summary_by_n.csv` |
| Gas and time vs. depth `d` | `experiment:repeated` (`by_depth`) | `quantitative/repeated_runs/by_depth/paper_table_by_depth.csv`, `dD/k.json`, `dD/verifier.json` |
| Deployment gas, bytecode vs. EIP-170 | `experiment:artifacts` | `quantitative/artifact_sizes.json` |
| Totals per scholarship round | single-run lot, 12 Sep 2026 | `quantitative/report_run/` |
| Qualitative criteria | `experiment:qualitative` | `qualitative/` |
| Sepolia validation | `experiment:sepolia` | `sepolia/validation_sepolia_*.json` / `.csv`; per-withdrawal log in `sepolia/run_sepolia/` |
| Anonymity by amount tier, wallet reuse | `experiment:anonymity` | `anonymity/anonymity_*.csv`, `anonymity_summary.json`, `wallet_reuse_n*.csv` |
| Groth16 withdrawal gas at `n = 500` | `Groth16`: `experiment:gas` | `Groth16/experiments/results/quantitative/gas_groth16_n500.csv`, mean of `verify_record_gas` + `settle_gas` |
| Groth16 verifier size | `Groth16`: `experiment:artifacts` | `Groth16/experiments/results/quantitative/artifact_sizes_groth16.json`, `verifier_contract.deployed_bytecode_bytes` |

Folder layout of the 20-run lot: `repeated_runs/run_config.json` (how the lot was run), then
`by_n/nN/` and `by_depth/dD/` per configuration, each with `runNN/` per run (`done.json` marks a finished run and
is written last), `per_run.csv` (per-run means) and `summary_<nN|dD>.csv` (mean, SD, min, max). Under
`by_depth/dD/` also `k.json` (every `K` tried and whether it had enough rows) and, in Mode B, `verifier.json`,
`Halo2Verifier.sol` / `Halo2Verifier.artifact.json` (the verifier compiled for that depth) and
`dataset_n<n>_d<d>.json` (the input at that depth).

## 7. Vietnamese names inside the data files

File and folder names were translated to English on 2026-10-20 without touching any file's contents, so some
JSON keys, CSV columns and values inside the published files are still Vietnamese. Regenerating every summary
table from the raw runs (§4, Level 1) reproduces every published number; only the experiment label column
differs (`theo_n` / `theo_d` in the published tables, `by_n` / `by_depth` in new output). The old file, folder, script and
variable names are listed in §9.

| Name | Where | Meaning |
|---|---|---|
| `thi_nghiem` | CSV column, `done.json` | experiment: `theo_n` = by pool size, `theo_d` = by depth (`by_n` / `by_depth` in runs made now) |
| `cau_hinh` | CSV column, `done.json`, `run_config.json` | configuration (`nN` or `dD`) |
| `cach_dem` | `summary_*.csv` | counting rule: `moi_lan_do` = one value per iteration; `moi_luot` = one value per run |
| `don_vi` | `summary_*.csv` | unit |
| `nguon` | `summary_*.csv`, `paper_table_*.csv` | source lot: `lap20` = the 20-run lot; `luot_bao_cao_12_09` = the single-run lot in `report_run/`, used only when a `by_n` lot lacks `n = 500` |
| `tach_gas` | Mode B tables | the split withdrawal, `verify_record_gas` + `settle_gas` |
| `k_thieu_hang` | Mode A `paper_table_by_depth.csv`, `k.json` | the largest `K` without enough rows |
| `k_toi_thieu`, `k_toi_thieu_du_hang` | `k.json`, Mode B `verifier.json` | the smallest `K` with enough rows |
| `cac_lan_thu`, `du_hang`, `lot_eip170`, `phep_thu`, `tieu_chi` | `k.json`, Mode B `verifier.json` | attempts, enough rows, fits EIP-170, the test applied, the selection rule |
| `do_luc`, `xuat_luc`, `bat_dau`, `ket_thuc`, `thoi_gian_ms` | JSON files | measured at, exported at, started, finished, duration |
| `so_lan_do`, `che_do`, `tien_trinh` | `done.json` | measured iterations; Mode A prover mode (`nong` = `warm`, `nguoi` = `cold`); process description |
| `theo_n`, `theo_d` (top-level keys), `so_luot`, `hat_giong`, `k_theo_cau_hinh`, `tim_k`, `dinh_nghia_luot` | `run_config.json` | one entry per experiment: runs per configuration, shuffle seed, `K` per configuration, `K` search, definition of a run; Mode B also `tieu_chi_chon_k` (rule for choosing `K`) and, inside `cau_hinh`, `thiNghiem` / `ten` (experiment / name) |
| `lan_khoi_chay`, `luot_chon`, `thu_tu`, `luot`, `may`, `so_luong_cpu`, `he_dieu_hanh`, `so_tep_sua_ngoai_ket_qua`, `tep_sua`, `duong_dan`, `kich_thuoc`, `sua_luc` | `run_config.json` | each launch: runs chosen, shuffled order, run number; machine, CPU count, operating system; number and list of files modified outside the results; prover binary path, size, modification time |
| `loai`, `buoc`, `ghi_chu` | `sepolia/*.csv` | row kind (`trien_khai` deploy, `duyet_root` root approval, `rut` withdrawal, `dung_lai` replay, `tieu_chi` criterion, `tong_hop` summary), step, note; `ĐẠT` / `DAT` = met |
| `meaning` | `qualitative/*-A-transparency.csv`, `*-B-privacy.csv` | partly Vietnamese; `condition_name`, `standard_quote` and `verdict` carry the criterion, the quoted clause and the result in English |
| `viTriNop`, `viTriChuoi`; Mode B `soCalldataDaSoi`, `verifierCalldataSinhVienKhac` | `qualitative/*.json` | submission position, position on chain; calldata blobs inspected, verifier calldata of another student |
| `thoiGian`, `ghiChu`, `nguon_dataset` | `Groth16/experiments/data/inputs_n*.json` | timings, note, source dataset |

Mode B's `by_depth/d7/k_remeasured_0917.json` is a re-measurement of the `K` attempts at `d = 7` written entirely
in Vietnamese; its result is the `cac_lan_thu` list (K = 11 and 12 fail, K = 13 builds).

## 8. Notes

- Mode A is cheaper per withdrawal because its contract does not verify the proof; the two modes differ in
  trust model, and the proving stacks differ as well (IPA/Pasta vs. KZG/BN254).
- Mode B KZG parameters come from the fixed seed `ChaCha20Rng::from_seed([42u8; 32])`. This is reproducible
  but is not a trusted setup. Mode A (IPA) needs no setup.
- The published numbers were measured before the code was refactored into the form shipped here (commit
  `4bae81a` holds the same results with the pre-refactor code). The refactor renamed files and removed comments,
  including from `ShieldedPool.sol`, `MockHalo2Verifier.sol` and the generated `Halo2Verifier.sol`; the prover's
  modes, JSON keys and output are unchanged. The compiled bytecode differs only in the Solidity metadata hash,
  which moves deployment gas slightly: Mode A `ShieldedPool` deploys for 12 gas less, Mode B `Halo2Verifier` for
  4 554 499 gas instead of the published 4 554 511, Mode B `ShieldedPool` is unchanged. Withdrawal gas is unchanged.
- Every key in this repository is a test key; dataset `private_key` fields are Ganache accounts of the
  mnemonic above.
- The contracts are a research prototype and have not been audited.

## 9. Names before the refactor

Commit `4bae81a` is the code the paper was written against; the refactor of 2026-10-20 renamed the items below
and kept their behaviour. Use this table when reading `4bae81a`, older notes, or a path quoted from it.

**Result folders and files** (under `<mode>/experiments/results/`; contents unchanged):

| Before | Now |
|---|---|
| `quantitative/luot_bao_cao/` | `quantitative/report_run/` |
| `quantitative/lap20_1509/` | `quantitative/repeated_runs/` |
| `theo_n/`, `theo_d/` | `by_n/`, `by_depth/` |
| `luotNN/` | `runNN/` |
| `xong.json`, `cau_hinh_chay.json`, `theo_luot.csv` | `done.json`, `run_config.json`, `per_run.csv` |
| `tong_hop_*.csv`, `bang_bai_bao_theo_n.csv`, `bang_bai_bao_theo_d.csv` | `summary_*.csv`, `paper_table_by_n.csv`, `paper_table_by_depth.csv` |
| `by_depth/d7/k_do_bu_1709.json` (Mode B) | `by_depth/d7/k_remeasured_0917.json` |
| `sepolia/kiem_nghiem_*` | `sepolia/validation_*` |
| qualitative suffixes `-A-minhbach`, `-B-riengtu`, `-C3-rangbuoc-amount`, `-dieukiendo`, `-sinhvien`, `-tieuchi` | `-A-transparency`, `-B-privacy`, `-C3-amount-binding`, `-measurement-conditions`, `-students`, `-criteria` |

**Runners and scripts:**

| Before | Now |
|---|---|
| `backend/src/experiments/lap20Experiment.ts`, `npm run experiment:lap20` | `repeatedRunsExperiment.ts`, `npm run experiment:repeated` |
| `backend/src/experiments/summarizeLap20.ts`, `npm run experiment:lap20:tonghop` | `summarizeRepeatedRuns.ts`, `npm run experiment:repeated:summary` |
| `backend/src/experiments/tinhChatChuanCsv.ts` | `standardPropertyCsv.ts` |
| Groth16 `npm run tonghop` / `sosanh` / `kiemdauvao` (`backend/src/scripts/tongHopKetQua.ts`, `soSanhBaNhanh.ts`, `kiemDauVao.ts`) | `npm run summary` / `compare` / `check-inputs` (`summarizeResults.ts`, `compareThreeBranches.ts`, `checkInputs.ts`) |

Every other `npm run` name is unchanged. New ones: `api:start` / `start` (web server), `student:password`,
`pool:fund-record`, `format`, `format:check`.

**Environment variables:**

| Before | Now |
|---|---|
| `KICH_BAN` | `SCENARIOS` |
| `THI_NGHIEM` (`theo_n` / `theo_d`) | `EXPERIMENT` (`by_n` / `by_depth`) |
| `DO_SAU`, `N_THEO_D` | `DEPTHS`, `N_PER_DEPTH` |
| `SO_LUOT`, `LUOT`, `HAT_GIONG` | `RUNS`, `ONLY_RUNS`, `SEED` |
| `THU_MUC_LAP`, `CHI_IN_KE_HOACH`, `LAM_LAI` | `RUNS_DIR`, `PLAN_ONLY`, `RERUN` |
| `CHE_DO` (`nong` / `nguoi`) | `PROVER_MODE` (`warm` / `cold`) |
| `KIEM_NGHIEM_RPC_URL`, `KIEM_NGHIEM_PRIVATE_KEY`, `KIEM_NGHIEM_PROOFS` | `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY`, `SEPOLIA_PROOFS` |
| Groth16 `THU_MUC_KQ`, `EP_CHAY_LAI` | `RESULTS_DIR`, `FORCE_RERUN` |

**Rust files** (both modes now use the same names):

| Before | Now |
|---|---|
| Mode A `circuits/src/main_circuit.rs` + `config.rs` | `circuits/src/circuit.rs` |
| Mode A `circuits/src/nullifier.rs` | merged into `circuits/src/commitment.rs` |
| `prover/src/inputs_builder.rs` | `prover/src/flow_inputs.rs` (flow requests) + `prover/src/experiment.rs` (batch / benchmark modes) |
| Mode A `prover/src/utils.rs` + `transfer_address.rs` | `prover/src/field.rs` |
| Mode A `prover/src/export_verifier.rs` | removed — it was not listed in `lib.rs`, so it was never compiled |

The prover's modes, JSON keys and output are unchanged, except the `prove-batch` key `so_sinh_vien`, now
`student_count`.

**Backend layout:** `backend/src/` keeps the layer folders `cli/`, `clients/`, `config/`, `models/`,
`repositories/`, `services/`, `utils/`, but files now follow the `<entity>.model.ts` / `<entity>.repo.ts` /
`<domain>.service.ts` / `<domain>.cli.ts` pattern; the old `controllers/*Controller.ts` wrappers and the singular
`client/` folder are gone (the web layer uses `routes/` → `controllers/` → `services/`).
