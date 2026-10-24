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
        ├── quantitative/depth_sweep_n100/     depth sweep d = 9, 16 … 24 with n = 100, 20 runs (added after the paper)
        ├── qualitative/               qualitative criteria run, n = 500
        ├── anonymity/                 anonymity by amount tier and the wallet-reuse probe (added after the paper)
        ├── insider/                   what a university insider can withdraw, step by step (added after the paper)
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
`paper_table_*.csv` files. Expected: every number is unchanged; only the experiment label in the first column
may differ from the committed tables. The `per_run.csv` files come out byte-identical.
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
| withdrawal gas (`verify_record_gas` + `settle_gas`) | 685 269 ± 56 |
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
(`N = 20`); a column of `summary_*.csv` states which rule applies. `by_depth` fills the tree at each depth
(`n = 2^d`) and takes the first `n` students of `dataset_n500.json`; `d = 9` is not re-measured there, it is
the `n = 500` configuration of `by_n`. The rule for choosing `K` per depth differs between the modes —
see the per-mode README.

Other settings of `experiment:repeated`: `RUNS` (runs per configuration, default 20), `WARMUP` (default 3),
`SCENARIOS` (the `n` list of `by_n`), `DEPTHS` (the `d` list of `by_depth`, default `1,2,3,4,5,6,7,8`),
`N_PER_DEPTH` (a fixed `n` at every depth instead of `2^d`), `ONLY_RUNS` (e.g. `1` or `1-3`), `SEED`, `RUNS_DIR`,
and `PLAN_ONLY=1` (print the plan and exit). `experiment:repeated:summary` reads `RUNS_DIR` and `RUNS`.

To resume after a stop: restart Ganache, then rerun the same command. Runs holding `done.json` are skipped.

### Depth sweep d = 16 … 24 (added after the paper)

```bash
cd backend
# Mode A
EXPERIMENT=by_depth DEPTHS=9,16,17,18,19,20,21,22,23,24 N_PER_DEPTH=100 RUNS=20 PROVER_MODE=warm RUNS_DIR=experiments/results/quantitative/depth_sweep_n100 npm run experiment:repeated
# Mode B
EXPERIMENT=by_depth DEPTHS=9,16,17,18,19,20,21,22,23,24 N_PER_DEPTH=100 RUNS=20 RUNS_DIR=experiments/results/quantitative/depth_sweep_n100 npm run experiment:repeated
RUNS_DIR=experiments/results/quantitative/depth_sweep_n100 npm run experiment:repeated:summary   # in each mode
```

Same protocol as Level 3 (20 runs, 3 warm-up iterations, shuffled order, seed `20260915`). A full tree is not
possible at these depths — it needs `2^d` proofs per run (65 536 at `d = 16`) — so every depth holds the first
100 students of `dataset_n500.json`; the per-withdrawal values depend on `d`, not on `n`. `d = 9` is measured
in the same sweep as an anchor and must agree with row `n100` of `repeated_runs/by_n/` (same `K`, same proof
size, gas and times within one SD). `K` chosen: Mode A 10 for `d = 16 … 21`, 11 for `d = 22 … 24`; Mode B 14
for every `d = 16 … 24`, with a verifier of at most 22 320 B (90.8 % of EIP-170). Duration on the machine in
§2: Mode A ≈ 2.6 h, Mode B ≈ 42 h.

### Other runners

```bash
cd backend
npm run experiment:artifacts                               # → quantitative/artifact_sizes.json
cp experiment.config.example.json experiment.config.json   # fill in wallets from the Ganache mnemonic
npm run experiment:qualitative -- ./experiment.config.json # Ganache + IPFS + MongoDB
npm run experiment:anonymity -- ./anonymity.config.json   # Ganache + IPFS + MongoDB
npm run experiment:sepolia                                 # needs SEPOLIA_RPC_URL and a funded SEPOLIA_PRIVATE_KEY in .env
npm run experiment:sepolia-fresh-proofs                    # 500 fresh recipient wallets and their proofs, for experiment:sepolia
npm run experiment:insider-proof                           # Mode B only: a real proof of the n = 1 note paid to the university wallet
cd ../contracts && npx hardhat run scripts/insiderExperiment.js   # insider steps on Hardhat's in-process chain → insider/*.csv
```

They write, respectively, `experiments/results/quantitative/artifact_sizes.json`; a new
`experiments/results/qualitative/qualitative[-onchain]-n<N>-<timestamp>.json` with six `.csv` beside it
(`-onchain` in Mode B only; see the per-mode README for the file list); `experiments/results/anonymity/`
(below); and `experiments/results/sepolia/validation_<network>.json` plus its `.csv` (fixed name, overwritten by the next run; the 12 Sep 2026 files keep their dated names).
`experiment:sepolia-fresh-proofs` writes `sepolia/fresh_recipients_n500.json` (addresses only, no keys) and
`sepolia/proofs_fresh_recipients_n500.json`; `experiment:insider-proof` writes `insider/diverted_proof_n1.json`;
`insiderExperiment.js` writes `insider/insider_offchain.csv` (Mode A) or `insider/insider_onchain.csv` (Mode B).

**Insider.** One row per attempted step, with its outcome, revert reason and gas. Mode A: the university pays
itself with fabricated nullifiers under an approved root (5 payouts against 1 published commitment); only the
root, nullifier reuse, the pool balance and `onlySchool` stop it. Mode B: a fabricated nullifier, a changed
recipient and a modified proof are all rejected; a university that knows `rho` can still prove the student's
note again to its own wallet (1 payout), after which the student's own claim is rejected with
`claim already recorded`. The contract tests `InsiderTrust.js` (Mode A) and `InsiderDiversion.js` (Mode B)
check the same behaviour; `insider/hardhat_insider.txt` is their log.

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

The default proofs pay the Ganache mnemonic's public wallets, and on Sepolia most of those addresses have been
delegated to contracts by third parties (EIP-7702) and reject ETH. `experiment:sepolia-fresh-proofs` therefore
draws 500 fresh recipient addresses and re-proves every note for them with the same root and nullifier; pass
the result with `SEPOLIA_PROOFS=experiments/results/sepolia/proofs_fresh_recipients_n500.json`.

The qualitative runner with `"resetDatabase": true` only accepts a database whose name contains
`qualitative` or `experiment`. Its verdicts (`pass` / `partial` / `by_design_not_met`) must match
`experiments/results/qualitative/qualitative-*n500-2026-09-12T*`.

Our Sepolia run of 12 Sep 2026, verifiable on Etherscan:

| Contract | Address |
|---|---|
| Mode A `ShieldedPool` | `0xb5dB57aBc6e8F99907db4D7b7511a6A1F7BCaaC1` |
| Mode B `ShieldedPool` | `0xB222C4f161F486A1860a29BAF83f74F952115359` |
| Mode B `Halo2Verifier` | `0xf6D276CB65E3040719aF610bc771941C6715340D` |

Our Sepolia run of 23 Oct 2026, 500 withdrawals per mode to fresh recipient wallets, all five criteria met
(`sepolia/validation_sepolia.json`, per-withdrawal log in `sepolia/run_sepolia/`):

| Contract | Address |
|---|---|
| Mode A `ShieldedPool` | `0x367DeBF01d08C429DDC8F68BbFa9894f148f3068` |
| Mode B `ShieldedPool` | `0xe953a5a9027Ce55E9dCc9557C09CaaCF2Bc5d4AD` |
| Mode B `Halo2Verifier` | `0x644f5112Dd508AE8917a35fA31377A2D8912F3E0` |

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
| Gas and time at `d = 16 … 24` (`n = 100`) | `experiment:repeated` (`by_depth`, `N_PER_DEPTH=100`) | `quantitative/depth_sweep_n100/by_depth/paper_table_by_depth.csv`, same layout as above |
| Deployment gas, bytecode vs. EIP-170 | `experiment:artifacts` | `quantitative/artifact_sizes.json` |
| Totals per scholarship round | single-run lot, 12 Sep 2026 | `quantitative/report_run/` |
| Qualitative criteria | `experiment:qualitative` | `qualitative/` |
| Sepolia validation | `experiment:sepolia` | 23 Oct 2026: `sepolia/validation_sepolia.json` / `.csv`, per-withdrawal log in `sepolia/run_sepolia/`; 12 Sep 2026: `sepolia/validation_sepolia_2026-09-12T*.json` |
| University insider | `insiderExperiment.js`, `InsiderTrust.js`, `InsiderDiversion.js` | `insider/insider_offchain.csv` (Mode A), `insider/insider_onchain.csv` (Mode B), `insider/hardhat_insider.txt` |
| Anonymity by amount tier, wallet reuse | `experiment:anonymity` | `anonymity/anonymity_*.csv`, `anonymity_summary.json`, `wallet_reuse_n*.csv` |
| Groth16 withdrawal gas at `n = 500` | `Groth16`: `experiment:gas` | `Groth16/experiments/results/quantitative/gas_groth16_n500.csv`, mean of `verify_record_gas` + `settle_gas` |
| Groth16 verifier size | `Groth16`: `experiment:artifacts` | `Groth16/experiments/results/quantitative/artifact_sizes_groth16.json`, `verifier_contract.deployed_bytecode_bytes` |

Folder layout of the 20-run lot: `repeated_runs/run_config.json` (how the lot was run), then
`by_n/nN/` and `by_depth/dD/` per configuration, each with `runNN/` per run (`done.json` marks a finished run and
is written last), `per_run.csv` (per-run means) and `summary_<nN|dD>.csv` (mean, SD, min, max). Under
`by_depth/dD/` also `k.json` (every `K` tried and whether it had enough rows) and, in Mode B, `verifier.json`,
`Halo2Verifier.sol` / `Halo2Verifier.artifact.json` (the verifier compiled for that depth) and
`dataset_n<n>_d<d>.json` (the input at that depth).

## 7. Notes

- Mode A is cheaper per withdrawal because its contract does not verify the proof; the two modes differ in
  trust model, and the proving stacks differ as well (IPA/Pasta vs. KZG/BN254).
- Mode B KZG parameters come from the fixed seed `ChaCha20Rng::from_seed([42u8; 32])`. This is reproducible
  but is not a trusted setup. Mode A (IPA) needs no setup.
- The published deployment gas was measured with comments still in `ShieldedPool.sol`, `MockHalo2Verifier.sol`
  and the generated `Halo2Verifier.sol`; the contracts shipped here carry none. The compiled bytecode differs
  only in the Solidity metadata hash, which moves deployment gas slightly: Mode A `ShieldedPool` deploys for 12 gas less, Mode B `Halo2Verifier` for
  4 554 499 gas instead of the published 4 554 511, Mode B `ShieldedPool` is unchanged. Withdrawal gas is unchanged.
- Every key in this repository is a test key; dataset `private_key` fields are Ganache accounts of the
  mnemonic above.
- The contracts are a research prototype and have not been audited.
