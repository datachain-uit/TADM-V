# Privacy-Preserving Scholarship Distribution with Dual-Mode Halo2 Verification — Artifact

This repository contains the prototype and the raw experimental data behind the paper. It implements one
scholarship-withdrawal protocol — note → Poseidon commitment → Merkle tree → Halo2 membership proof →
nullifier → withdrawal — in **two verification modes**:

| | Mode A — off-chain verification | Mode B — on-chain verification |
|---|---|---|
| Proof system | Halo2, IPA over Pasta curves (`halo2_proofs` 0.3.2) | Halo2, KZG/SHPLONK over BN254 (`halo2-axiom` 0.5.1, `halo2-base` 0.5.0, `snark-verifier-sdk` 0.2.3) |
| Who verifies the proof | the university backend | the smart contract, through a generated `Halo2Verifier.sol` |
| Contract entry point | `withdrawOffChain(root, nullifier, recipient, amount)` — takes no proof | `verifyAndRecord(proof, …)` then `settle(nullifier)` |
| Circuit size parameter `K` at depth `d = 9` | 9 | 13 |
| Details | [`Mode A/README.md`](Mode%20A/README.md) | [`Mode B/README.md`](Mode%20B/README.md) |

Both modes use the same public inputs, in this order: **`[root, nullifier, amount, recipient]`**. The private
witness is `student_id`, `rho` and the Merkle path. `recipient` (the student's wallet, left-padded to 32
bytes) is bound to the proof but is not part of the commitment.

> ⚠️ **The two modes are not equivalent in trust.** Mode A is cheaper precisely because the contract does
> not verify the proof; it trusts the backend. The gas ratio between the modes should always be read
> together with this difference. The proving stacks also differ (IPA/Pasta vs. KZG/BN254), so timing
> differences are an **implementation-level** comparison, not a property of on-chain vs. off-chain
> verification in general.

---

## 1. Repository layout

```
.
├── Mode A/                           off-chain verification
│   ├── circuits/                     Halo2 circuit (Poseidon, commitment, nullifier, Merkle tree)
│   ├── prover/                       Rust CLI over the circuit (argv mode, JSON over stdin/stdout)
│   ├── contracts/                    ShieldedPool.sol + Hardhat tests
│   ├── backend/                      TypeScript: cli → controllers → services → repositories/clients
│   │   └── src/experiments/          experiment runners (see §4)
│   ├── shared/params.bin             IPA parameters for K = 9
│   ├── FULL_FLOW_GUIDE.md            step-by-step manual walkthrough (Vietnamese)
│   └── experiments/
│       ├── data/                     input datasets dataset_n{1,10,30,60,100,500}.json
│       └── results/                  raw results used in the paper
└── Mode B/                           on-chain verification — same layout, plus
    ├── contracts/contracts/Halo2Verifier.sol   generated verifier
    └── FULL_FLOW_TEST.md                       step-by-step manual walkthrough (Vietnamese)
```

Both modes read **the same input datasets** (same content; line endings differ in three files, so compare
normalised content rather than raw SHA-256).

## 2. Tested environment

All reported numbers were measured on this single machine:

| Item | Version / value |
|---|---|
| OS | Windows 11 (build 26200) |
| CPU / RAM | Intel Core i5-1135G7 (4 cores, 8 threads) · 7.7 GB |
| Rust | 1.94.1 (pinned in `rust-toolchain.toml`) |
| Node.js | 22.13.0 (Hardhat 2 prints a warning on Node 22; it is harmless) |
| Ganache | 7.9.2 |
| Hardhat | 2.28.6 (Mode A) · 2.22.0 (Mode B) |
| Solidity | 0.8.19 / 0.8.20, `evmVersion: "paris"` |
| web3.js / ethers | 4.16.0 / 6.16.0 |
| IPFS (Kubo) | 0.41.0 — only for the end-to-end flow and the qualitative experiment |
| MongoDB | MongoDB Atlas — only for the end-to-end flow and the qualitative experiment; any MongoDB instance works |

Exact dependency versions are locked by `Cargo.lock` and `package-lock.json`.

> **Platform note.** Experiments were run on Windows. The Mode A backend looks for the prover at
> `Mode A/target/release/prover.exe`. On Linux/macOS, after building, copy or symlink the binary:
> `cp "Mode A/target/release/prover" "Mode A/target/release/prover.exe"`. The Mode B backend also accepts
> `PROVER_BIN=/path/to/prover`.

## 3. Setup

Repeat inside `Mode A/` and `Mode B/` (quote the paths — the folder names contain a space):

```bash
cargo build --release -p prover          # the backend spawns target/release/prover(.exe)

cd contracts && npm ci && npm run compile && cd ..
cd backend   && npm ci && cp .env.example .env && cd ..
```

Start Ganache **exactly** like this. The runners check the mnemonic and abort if it differs, and `n = 500`
needs 501 accounts:

```bash
ganache --wallet.totalAccounts 501 --wallet.mnemonic "test test test test test test test test test test test junk"
```

**Do not run the two modes at the same time.** Both use the same Ganache instance and the same
`accounts[0]`.

Sanity checks:

```bash
cd backend   && npm run typecheck && npm test     # both modes
cd contracts && npm test                          # Mode B tests read experiments/results/quantitative/proofs_n{1,10}.json
cargo test --workspace --locked                   # Mode A only; generates a real proof, slow
```

Only the end-to-end flow (§5) and the qualitative experiment need IPFS and MongoDB. Everything in §4 runs
with Ganache alone, or with no services at all.

## 4. Reproducing the measurements

Three levels, from seconds to days. Mode-specific commands and expected output are in each mode's README.

### Level 1 — recompute every table from the raw data (seconds, no services)

```bash
cd backend && npm run experiment:lap20:tonghop
```

This reads every completed run under `experiments/results/quantitative/lap20_1509/` and rewrites the summary
files next to them. **The output must be byte-identical to the committed files** — `git status` stays clean.
This is the cheapest check that the published raw data really produces the published tables.

### Level 2 — quick re-measurement (minutes, Ganache only)

```bash
cd backend
THI_NGHIEM=theo_n LUOT=1 KICH_BAN=10 THU_MUC_LAP=experiments/results/quantitative/check npm run experiment:lap20
THU_MUC_LAP=experiments/results/quantitative/check npm run experiment:lap20:tonghop
```

On Windows PowerShell set the variables with `$env:THI_NGHIEM = "theo_n"` and so on. Use a separate
`THU_MUC_LAP` so the committed results are not touched.

| Quantity | Expected agreement |
|---|---|
| Gas per withdrawal (Mode A `withdraw_gas`, Mode B `verify_record_gas` + `settle_gas`) | reproduces within the per-student spread in the paper (Mode A ≈ ±5 gas, Mode B ≈ ±75 gas). Gas is deterministic for a given bytecode and EVM version; the small spread comes from the byte content of each proof's calldata |
| Deployment gas, root-approval gas, bytecode size | identical |
| Proof generation / verification time | **machine- and load-dependent.** Compare the trend (flat in `n`) rather than absolute milliseconds. In our own re-check, Mode A reproduced within ±1 SD while Mode B came out about 22 % faster than the 20-run lot — that lot ran for ~26 h on a busy machine, the re-check took 1.3 min on an idle one |

### Level 3 — full re-run

```bash
cd backend
THI_NGHIEM=theo_n npm run experiment:lap20     # d = 9, n ∈ {1, 10, 30, 60, 100, 500}
THI_NGHIEM=theo_d npm run experiment:lap20     # d ∈ {1 … 8}, tree filled: n = 2^d (2 … 256)
npm run experiment:lap20:tonghop
```

Run Mode A first and Mode B afterwards — never concurrently. Measured duration on the machine in §2 —
`theo_n`: Mode A ≈ 2 h, Mode B ≈ 27 h (≈ 62 min per `n = 500` run). `theo_d`: Mode A ≈ 1.5 h, Mode B ≈ 24 h.

In `theo_d` each depth **fills its tree** (`n = 2^d`), so the depth and the number of leaves move together —
that is what the depth is for. The point `d = 9` is not re-measured here; it is the `n = 500` configuration
of `theo_n` (97.7 % of a depth-9 tree). The datasets are the **first `n` students of `dataset_n500.json`**,
not newly generated ones, so both experiments describe the same students.

**Method.**

- Every configuration is run **20 times independently**, and every run has the same structure: Ganache
  snapshot → **3 warm-up iterations** (recorded with `warmup = true`, excluded from statistics) → `n`
  measured iterations → revert.
- Within each of the 20 rounds, the order of configurations is shuffled with a fixed seed (`20260915`).
- Mode A starts a fresh prover process for every proof and every verification. Mode B starts one fresh
  `bench-from-dataset` process per run: key generation once, then warm-up, then `n` proofs. Key generation
  time (`setup_ms`) is excluded from `proof_generation_ms` in both modes.
- **Reported values are mean ± sample SD** over all measured iterations (`N = 20 · n`). Quantities constant
  within a run (e.g. `update_root_gas`, deployment gas, Mode B `setup_ms`) are counted **once per run**
  (`N = 20`); the column `cach_dem` records which rule was applied.
- `theo_d` chooses `K` per depth, and **the rule differs between the modes** — see each mode's README.

A stopped run can be resumed with the same command: runs that have `xong.json` are skipped. **Restart
Ganache first**, because an interrupted run cannot revert its chain state.

### Other experiments

```bash
cd backend
npm run experiment:artifacts                               # contract sizes → quantitative/artifact_sizes.json
cp experiment.config.example.json experiment.config.json   # then fill in wallets from the Ganache mnemonic
npm run experiment:qualitative -- ./experiment.config.json # needs Ganache + IPFS + MongoDB
npm run experiment:sepolia                                 # public-testnet validation, needs a funded Sepolia key
```

With `"resetDatabase": true`, the qualitative runner only accepts a database whose name contains
`qualitative` or `experiment`. The paper's run is
`experiments/results/qualitative/qualitative-*n500-2026-09-12T*`; the verdicts (`pass` / `partial` /
`by_design_not_met`) must reproduce exactly.

Our Sepolia run (12 Sep 2026) can be checked on Etherscan without re-running:

| Contract | Address |
|---|---|
| Mode A `ShieldedPool` | `0xb5dB57aBc6e8F99907db4D7b7511a6A1F7BCaaC1` |
| Mode B `ShieldedPool` | `0xB222C4f161F486A1860a29BAF83f74F952115359` |
| Mode B `Halo2Verifier` | `0xf6D276CB65E3040719aF610bc771941C6715340D` |

`updateRoot` costs more on Sepolia than on Ganache because Sepolia applies the EIP-7623 calldata floor
(Prague), while the Ganache runs use an earlier hardfork.

## 5. Running the protocol end to end

The measurement runners never touch IPFS or MongoDB; they drive the contracts directly. To exercise the
*whole* system instead — issue a real note, encrypt it to IPFS, publish the Merkle root, decrypt, prove,
withdraw, and watch the nullifier block a second withdrawal — follow the walkthrough in the mode's README
(§ *End-to-end flow*). **That flow is the only thing that demonstrates the double-spend guard.**

It needs Ganache **and** IPFS **and** MongoDB, and it writes to the database, so point `MONGODB_URI` at a
scratch database rather than one holding experiment data.

### Two things that will bite a scripted run

1. **The two modes print differently.** Mode B writes a single JSON object to stdout, so
   `… | ConvertFrom-Json` or `| jq` works directly. **Mode A does not**: it interleaves MongoDB connection
   lines, prints labelled values (`STUDENT PUBLIC KEY: 0x04…`), and answers some commands with a
   human-readable report instead of JSON. Parse Mode A output from the first `{`, or by regex. Field names
   differ too — Mode A returns `universityId` / `poolId` / `requestId`, Mode B returns `_id`.
2. **Windows PowerShell 5.1 prepends a UTF-8 BOM when piping into a child process**, so the one command
   that reads stdin (`withdrawal:create`) fails with `Unexpected token '﻿'`. Setting `$OutputEncoding`
   is not enough. Write the JSON to a file with `UTF8Encoding($false)` and feed it through `cmd`:

   ```powershell
   [IO.File]::WriteAllText($tmp, $submissionJson, (New-Object System.Text.UTF8Encoding $false))
   cmd /c "type `"$tmp`" | npm run --silent withdrawal:create"
   ```

   On Linux/macOS, or in PowerShell 7, the plain pipeline in the walkthroughs works as written.

## 6. Where each result in the paper comes from

| Paper result | Command | File |
|---|---|---|
| Per-withdrawal gas and proof/verification time vs. pool size `n` | `experiment:lap20` (`theo_n`) | `experiments/results/quantitative/lap20_1509/theo_n/bang_bai_bao_theo_n.csv` (full statistics: `tong_hop_theo_n.csv`) |
| Cost and time vs. Merkle depth `d` | `experiment:lap20` (`theo_d`) | `…/lap20_1509/theo_d/bang_bai_bao_theo_d.csv`, `dD/k.json`, `dD/verifier.json` |
| Deployment gas, bytecode size vs. EIP-170 | `experiment:artifacts` | `experiments/results/quantitative/artifact_sizes.json` |
| Totals per scholarship round (sum over `n` withdrawals) | single-run lot of 12 Sep 2026 | `experiments/results/quantitative/luot_bao_cao/` |
| Qualitative criteria (transparency, privacy, amount binding) | `experiment:qualitative` | `experiments/results/qualitative/` |
| Sepolia validation | `experiment:sepolia` | `experiments/results/sepolia/kiem_nghiem_sepolia_*.json/.csv` |

## 7. Glossary of Vietnamese identifiers

The experiment code is written in English. What is still Vietnamese is the **naming of the data**: directory
names, output file names, CSV column names, environment variables, and the keys inside the JSON files the
runners write.

That was deliberate, and the reason is reproducibility rather than convenience. Those names are not labels
printed for a reader — the runners and the summary script **read** them: a run is recognised as finished by
the presence of `xong.json`, a configuration by its `nN` / `dD` directory, a metric's counting rule by the
`cach_dem` column. Renaming them after the measurements had been taken would mean either re-running every
experiment (about 28 hours) or leaving the committed results unreadable by the code that produced them. The
tables below give the English meaning of every such name, so nothing in the output depends on reading
Vietnamese.

Elsewhere, comments and some identifiers are still Vietnamese; those are the parts of the system this
artifact does not ask the reader to inspect. The two `FULL_FLOW_*.md` walkthroughs are Vietnamese as well —
each mode's README summarises them in English.

**Environment variables (LAP20 runner)**

| Name | Meaning |
|---|---|
| `THI_NGHIEM` | experiment: `theo_n` (vary pool size) or `theo_d` (vary tree depth) |
| `SO_LUOT` | number of runs per configuration (default 20) |
| `WARMUP` | warm-up iterations per run (default 3) |
| `KICH_BAN` | pool sizes `n` for `theo_n` |
| `DO_SAU` | depths `d` for `theo_d` (default `1,2,3,4,5,6,7,8`) |
| `N_THEO_D` | use one fixed `n` at every depth; unset ⇒ fill the tree, `n = 2^d` |
| `LUOT` | run only these run numbers, e.g. `1`, `1-3` |
| `HAT_GIONG` | shuffle seed |
| `THU_MUC_LAP` | output root directory |
| `CHI_IN_KE_HOACH=1` | print the plan only |
| `BENCH_OUT_DIR`, `BENCH_WARMUP` | Mode B prover: output directory, warm-up count |
| `MERKLE_DEPTH`, `HALO2_K` | Mode A prover: override `d` and `K` (defaults 9 and 9) |
| `KIEM_NGHIEM_RPC_URL`, `KIEM_NGHIEM_PRIVATE_KEY`, `KIEM_NGHIEM_PROOFS` | Sepolia validation: RPC, funded key, alternative proof file |

**Folders and files**

| Name | Meaning |
|---|---|
| `lap20_1509/` | repeated-run lot (20 runs) |
| `theo_n/`, `theo_d/` | by pool size / by depth |
| `nN/`, `dD/`, `luotNN/` | configuration `n = N` or `d = D`; run number NN |
| `xong.json` | "run complete" marker plus run metadata. Written **last**, which is what makes a stopped experiment resumable: a run folder without it is deleted and redone |
| `cau_hinh_chay.json` | how the lot was run — runs per configuration, warm-up count, shuffle seed, the shuffled order of every round, the `K` chosen per configuration and how it was chosen, plus machine, git commit and SHA-256 of the prover binary for each launch. This is the file to read to check that a lot was measured the way the paper says it was |
| `dD/k.json` | the `K` probe at depth `d`: every `K` tried and whether it had enough rows |
| `dD/verifier.json` | Mode B only — the `K` chosen at depth `d`, the deployed bytecode size, its share of EIP-170, and every attempt |
| `dD/Halo2Verifier.artifact.json`, `dD/Halo2Verifier.sol` | the verifier compiled for that depth, deployed by every run of it |
| `dD/dataset_n<n>_d<d>.json` | Mode B input for that depth: the first `n` students of `dataset_n500.json` with `merkle_depth` set to `d` |
| `_luu_tru/` | archive: earlier or superseded lots, kept rather than deleted |
| `tong_hop_*.csv` | summary statistics (mean, SD, min, max) |
| `theo_luot.csv` | per-run means |
| `bang_bai_bao_*.csv` | paper-ready "mean ± SD" table |
| `luot_bao_cao/` | single-run lot of 12 Sep 2026 |
| `kiem_nghiem_sepolia_*` | Sepolia validation evidence |
| qualitative suffixes `tieuchi` · `A-minhbach` · `B-riengtu` · `C3-rangbuoc-amount` · `dieukiendo` · `sinhvien` | criteria · transparency properties · privacy properties · amount binding · measurement conditions · per student |

**CSV columns**

| Column | Meaning |
|---|---|
| `thi_nghiem`, `cau_hinh`, `run_id`, `iteration`, `warmup` | experiment, configuration, run, iteration, warm-up flag |
| `d`, `k` | Merkle depth and the Halo2 parameter `K` in force for that row |
| `R`, `N` | number of runs contributing, and number of values the statistics were computed over |
| `cach_dem` | counting rule: `moi_lan_do` = one value per measured iteration; `moi_luot` = one value per run |
| `nguon` | data source (`lap20` or `luot_bao_cao_12_09`) |
| `don_vi` | unit |
| `tach_gas` | Mode B gas of one withdrawal in the split design = `verify_record_gas` + `settle_gas` |

## 8. Security notes and limitations

- **Mode B KZG parameters are generated from a fixed seed** (`ChaCha20Rng::from_seed([42u8; 32])`) so that
  results are reproducible. **This is not a trusted setup**: anyone can recompute the trapdoor. A real
  deployment needs parameters from a proper ceremony. Mode A uses IPA, which needs no trusted setup.
- Every private key in this repository is a **test key**. The `private_key` fields in the datasets are
  Ganache accounts derived from the public mnemonic above. Never use them on a real network.
- The contracts are a research prototype and have not been audited.
- Timing results depend on the machine in §2 and on how loaded it is. Gas results do not.
- The results were produced by the code at tag `<TAG>`. `cau_hinh_chay.json` records the commit at launch
  time, which predates the commit of the LAP20 runner itself; the runner logic is identical at `<TAG>`.

## 9. Citation and license

`<citation of the paper>` · License: `<to be decided>`
