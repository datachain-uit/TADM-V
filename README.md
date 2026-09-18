# Privacy-Preserving Scholarship Distribution with Dual-Mode Halo2 Verification — Artifact

> **DRAFT (15 Sep 2026).** This is the draft `README.md` of the public artifact repository. Placeholders
> in `<angle brackets>` are filled in when the repository is created. File selection:
> `DANH_SACH_TEP_CONG_BO.md` (internal).

This repository contains the prototype and the raw experimental data behind the paper. It implements one
scholarship-withdrawal protocol — note → Poseidon commitment → Merkle tree → Halo2 membership proof →
nullifier → withdrawal — with **two verification modes**:

| | Mode A — off-chain verification (`Mode A/`) | Mode B — on-chain verification (`Mode B/`) |
|---|---|---|
| Proof system | Halo2, IPA over Pasta curves (`halo2_proofs` 0.3.2) | Halo2, KZG/SHPLONK over BN254 (`halo2-axiom` 0.5.1, `halo2-base` 0.5.0, `snark-verifier-sdk` 0.2.3) |
| Who verifies the proof | the university backend | the smart contract, through a generated `Halo2Verifier.sol` |
| Contract entry point | `withdrawOffChain(root, nullifier, recipient, amount)` — takes no proof | `verifyAndRecord(proof, …)` then `settle(nullifier)` |
| Circuit size parameter `K` at depth `d = 9` | 9 | 13 |

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
│   └── experiments/
│       ├── data/                     input datasets dataset_n{1,10,30,60,100,500}.json
│       └── results/                  raw results used in the paper
└── Mode B/                           on-chain verification — same layout, plus contracts/contracts/Halo2Verifier.sol
```

Both modes read **the same input datasets** (same content; line endings differ in three files).

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
| IPFS (Kubo) | 0.41.0 — only for dataset preparation and the qualitative experiment |
| MongoDB | MongoDB Atlas — only for the qualitative experiment; any MongoDB instance should work |

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
cd backend && npm run typecheck && npm test      # both modes
cd contracts && npm test                          # Mode B tests read experiments/results/quantitative/proofs_n1.json, proofs_n10.json
cargo test --workspace --locked                   # Mode A only; generates a real proof, slow
```

## 4. Reproducing the results

Three levels, from seconds to days.

### Level 1 — recompute every table from the raw data (seconds, no services)

```bash
cd backend && npm run experiment:lap20:tonghop
```

This reads every completed run under `experiments/results/quantitative/lap20_1509/` and rewrites the
summary files next to them. The output must match the committed files exactly.

### Level 2 — quick re-measurement (minutes, Ganache only)

```bash
cd backend
THI_NGHIEM=theo_n LUOT=1 KICH_BAN=10 THU_MUC_LAP=experiments/results/quantitative/check npm run experiment:lap20
THU_MUC_LAP=experiments/results/quantitative/check npm run experiment:lap20:tonghop
```

(On Windows PowerShell set the variables with `$env:THI_NGHIEM = "theo_n"` and so on.)
Use a separate `THU_MUC_LAP` so the committed results are not touched.

Expected, for one run with `n = 10`:

| Quantity | Expected agreement |
|---|---|
| Gas per withdrawal (Mode A `withdraw_gas`, Mode B `verify_record_gas` + `settle_gas`) | same value within the per-student spread reported in the paper (Mode A about ±5 gas, Mode B about ±75 gas). Gas is deterministic for a given bytecode and EVM version; the small spread comes from the byte content of each proof's calldata |
| Deployment gas, root-approval gas, bytecode size | identical |
| Proof generation / verification time | machine-dependent. Compare the **trend** (flat in `n`) and the ratio between modes, not absolute milliseconds |

### Level 3 — full re-run

#### 4.1 Quantitative experiment (LAP20)

```bash
cd backend
THI_NGHIEM=theo_n npm run experiment:lap20     # d = 9, n ∈ {1, 10, 30, 60, 100, 500}
THI_NGHIEM=theo_d npm run experiment:lap20     # d ∈ {1 … 8}, tree filled: n = 2^d (2 … 256)
npm run experiment:lap20:tonghop
```

Run Mode A first and Mode B afterwards: the two share one Ganache instance and the same `accounts[0]`, so
they must never run at the same time.

Measured duration on the machine in §2 — `theo_n`: Mode A about 2 h, Mode B about 27 h (about 62 min per
`n = 500` run). `theo_d`: Mode A about 1.5 h, Mode B about 24 h.

In `theo_d` each depth **fills its tree** (`n = 2^d`), so the depth and the number of leaves move together —
that is what the depth is for. The point `d = 9` is not re-measured here; it is the `n = 500` configuration
of `theo_n` (97.7 % of a depth-9 tree). The datasets are the **first `n` students of `dataset_n500.json`**,
not newly generated ones, so both experiments describe the same students.

**Method.**
- Every configuration is run **20 times independently**, and every run has the same structure: Ganache
  snapshot → **3 warm-up iterations** (recorded with `warmup = true`, excluded from statistics) → `n`
  measured iterations → revert.
- Within each of the 20 rounds, the order of configurations is shuffled with a fixed seed (`20260915`).
- Mode A starts a fresh prover process for every proof and every verification.
- Mode B starts one fresh `bench-from-dataset` prover process per run: key generation once, then warm-up,
  then `n` proofs. Key generation time (`setup_ms`) is excluded from `proof_generation_ms` in both modes.
- **Reported values are mean ± sample SD** over all measured iterations (`N = 20 · n`). Quantities that are
  constant within a run (e.g. `update_root_gas`, deployment gas, Mode B `setup_ms`) are counted **once
  per run** (`N = 20`); the column `cach_dem` records which rule was applied.
- `theo_d` chooses `K` per depth, and **the rule differs between the two modes** — measured, not assumed:
  - **Mode A**: the smallest `K` that still has enough rows, probed upwards from `K = 4` with
    `prover check-k`, so every smaller `K` has been tried and has failed. The probe and all its attempts
    are recorded in `theo_d/dD/k.json`.
  - **Mode B**: the smallest `K` whose **verifier still fits EIP-170** (deployed bytecode ≤ 24 576 bytes).
    A smaller `K` does *not* fail in halo2-base — it is answered with **more advice columns**, and every
    extra column inflates the verifier. Measured at `d = 1`: `K = 10` has enough rows but produces a
    31 110-byte verifier, over the limit, while `K = 11` fits. Each depth's chosen `K`, its bytecode size
    and every attempt are recorded in `theo_d/dD/verifier.json`.
  Mode B exports and compiles one verifier per depth before the runs, then restores the `d = 9` verifier
  and checks that its bytecode is byte-identical to the one it started from.

A stopped run can be resumed with the same command: runs that have `xong.json` are skipped. **Restart
Ganache first**, because an interrupted run cannot revert its chain state.

#### 4.2 Qualitative experiment

Requires Ganache, IPFS and MongoDB.

```bash
cd backend
cp experiment.config.example.json experiment.config.json
# fill in wallet addresses / keys from the Ganache mnemonic above; set "studentCount": 500
npm run experiment:qualitative -- ./experiment.config.json
```

With `"resetDatabase": true`, the runner only accepts a database whose name contains `qualitative` or
`experiment`. The paper's run is `experiments/results/qualitative/qualitative-*n500-2026-09-12T*`. Verdicts
(`pass` / `partial` / `by_design_not_met`) must reproduce exactly.

#### 4.3 Contract sizes

```bash
cd backend && npm run experiment:artifacts   # → experiments/results/quantitative/artifact_sizes.json
```

#### 4.4 Public-testnet validation (Sepolia)

```bash
cd backend
# in backend/.env:  KIEM_NGHIEM_RPC_URL=<your Sepolia RPC>   KIEM_NGHIEM_PRIVATE_KEY=<a funded Sepolia key>
npm run experiment:sepolia
```

This deploys the contracts, approves a 500-leaf root, withdraws for students 0, 250 and 499, replays a
nullifier (which must be rejected), and rebuilds the tree from on-chain events. Our run (12 Sep 2026) can be
checked on Sepolia Etherscan without re-running:

| Contract | Address |
|---|---|
| Mode A `ShieldedPool` | `0xb5dB57aBc6e8F99907db4D7b7511a6A1F7BCaaC1` |
| Mode B `ShieldedPool` | `0xB222C4f161F486A1860a29BAF83f74F952115359` |
| Mode B `Halo2Verifier` | `0xf6D276CB65E3040719aF610bc771941C6715340D` |

`updateRoot` costs more on Sepolia than on Ganache because Sepolia applies the EIP-7623 calldata floor
(Prague), while the Ganache runs use an earlier hardfork.

## 5. Where each result in the paper comes from

| Paper result | Command | File |
|---|---|---|
| Per-withdrawal gas and proof/verification time vs. pool size `n` | `experiment:lap20` (`theo_n`) | `experiments/results/quantitative/lap20_1509/theo_n/bang_bai_bao_theo_n.csv` (full statistics: `tong_hop_theo_n.csv`) |
| Cost and time vs. Merkle depth `d` | `experiment:lap20` (`theo_d`) | `…/lap20_1509/theo_d/bang_bai_bao_theo_d.csv`, `dD/k.json`, `dD/verifier.json` |
| Deployment gas, bytecode size vs. EIP-170 | `experiment:artifacts` | `experiments/results/quantitative/artifact_sizes.json` |
| Totals per scholarship round (sum over `n` withdrawals) | single-run lot of 12 Sep 2026 | `experiments/results/quantitative/luot_bao_cao/` |
| Qualitative criteria (transparency, privacy, amount binding) | `experiment:qualitative` | `experiments/results/qualitative/` |
| Sepolia validation | `experiment:sepolia` | `experiments/results/sepolia/kiem_nghiem_sepolia_*.json/.csv` |

`<to be finalised against the table numbers of the camera-ready paper>`

## 6. Glossary of Vietnamese identifiers

The experiment code itself is written in English. What is still Vietnamese is the **naming of the data**:
directory names, output file names, CSV column names, environment variables, and the keys inside the JSON
files the runners write.

That was deliberate, and the reason is reproducibility rather than convenience. Those names are not labels
printed for a reader — the runners and the summary script **read** them: a run is recognised as finished by
the presence of `xong.json`, a configuration by its `nN` / `dD` directory, a metric's counting rule by the
`cach_dem` column. Renaming them after the measurements had been taken would mean either re-running every
experiment (about 28 hours) or leaving the committed results unreadable by the code that produced them. The
tables below give the English meaning of every such name, so nothing in the output depends on reading
Vietnamese.

Elsewhere in the two repositories, comments and some identifiers are still Vietnamese; those are the parts
of the system this artifact does not ask the reader to inspect.

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
| `luotNN/prover.log` | Mode B only — stdout/stderr of that run's prover process |
| `_luu_tru/` | archive: earlier or superseded lots, kept rather than deleted |
| `luotNN/proofs.json` | the proofs produced by that run (measured iterations only, warm-up excluded) |
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

## 7. Security notes and limitations

- **Mode B KZG parameters are generated from a fixed seed** (`ChaCha20Rng::from_seed([42u8; 32])`) so that
  results are reproducible. **This is not a trusted setup**: anyone can recompute the trapdoor. A real
  deployment needs parameters from a proper ceremony. Mode A uses IPA, which needs no trusted setup.
- Every private key in this repository is a **test key**. The `private_key` fields in the datasets are
  Ganache accounts derived from the public mnemonic above. Never use them on a real network.
- The contracts are a research prototype and have not been audited.
- Timing results depend on the machine in §2. Gas results do not.
- The results were produced by the code at tag `<TAG>`. `cau_hinh_chay.json` records the commit at launch
  time, which predates the commit of the LAP20 runner itself; the runner logic is identical at `<TAG>`.

## 8. Citation and license

`<citation of the paper>` · License: `<to be decided>`
