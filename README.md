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

## 1. Layout

```
Mode A/ , Mode B/
├── circuits/              Halo2 circuit: Poseidon, commitment, nullifier, Merkle tree
├── prover/                Rust CLI over the circuit; modes on argv, JSON on stdin/stdout
├── contracts/             ShieldedPool.sol (+ Halo2Verifier.sol in Mode B) and Hardhat tests
├── backend/               TypeScript: cli → controllers → services → repositories / clients
│   ├── src/experiments/   the runners listed in §4
│   └── .env.example       copy to .env
├── shared/params.bin      Mode A only: IPA parameters for K = 9
└── experiments/
    ├── data/              dataset_n{1,10,30,60,100,500}.json — inputs
    └── results/
        ├── quantitative/lap20_1509/   20-run lot: the numbers in the paper
        ├── quantitative/luot_bao_cao/ single-run lot, 12 Sep 2026: per-round totals
        ├── quantitative/artifact_sizes.json   bytecode sizes
        ├── qualitative/               qualitative criteria run, n = 500
        └── sepolia/                   public-testnet validation
```

Both modes read the same datasets (identical content; three files differ in line endings only).

## 2. Requirements

| | |
|---|---|
| Rust | 1.94.1 (pinned in `rust-toolchain.toml`) |
| Node.js | 20 LTS or 22 (measured on 22.13.0) |
| Ganache | 7.9.2 |
| IPFS (Kubo) | 0.41.0 — only for §5 and the qualitative runner |
| MongoDB | any instance — only for §5 and the qualitative runner |
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
cd backend   && npm run typecheck && npm test    # Mode A 37 tests, Mode B 39 tests
cd contracts && npm test                         # Mode A 9 tests, Mode B 34 tests
cargo test --workspace --locked                  # Mode A only, 3 tests, generates a real proof
```

These run without IPFS or MongoDB, with `.env` left at its example values.

## 4. Reproducing the measurements

### Level 1 — rebuild every table from the raw data (seconds, no services)

```bash
cd backend && npm run experiment:lap20:tonghop
```

Reads every run under `experiments/results/quantitative/lap20_1509/` and rewrites the summary files.
Expected: the files are unchanged — `git status` reports nothing.

### Level 2 — re-measure one configuration (minutes, Ganache)

Requires all of §3: without `cargo build` it fails on a missing `target/release/prover.exe`, without
`npm run compile` on `Cannot find module …/ShieldedPool.json`.

```bash
cd backend
THI_NGHIEM=theo_n LUOT=1 KICH_BAN=10 THU_MUC_LAP=experiments/results/quantitative/check npm run experiment:lap20
THU_MUC_LAP=experiments/results/quantitative/check npm run experiment:lap20:tonghop
```

PowerShell: `$env:THI_NGHIEM = "theo_n"`, and so on. Output goes to `quantitative/check/`, which is
ignored by git, so the committed results stay untouched.

Compare `check/theo_n/bang_bai_bao_theo_n.csv` with row `n10` of
`lap20_1509/theo_n/bang_bai_bao_theo_n.csv`:

| Mode A, `n = 10` | 20 runs, N = 200 | 1 run, N = 10 |
|---|---|---|
| `withdraw_gas` | 64 665 ± 5 | 64 665 ± 5 |
| `proof_generation_ms` | 210.1 ± 23.0 | 211.8 ± 16.1 |
| `verify_native_ms` | 7.3 ± 0.7 | 7.2 ± 1.0 |
| `setup_ms` | 127.5 ± 14.6 | 123.6 ± 7.9 |

| Mode B, `n = 10` | 20 runs, N = 200 | 1 run, N = 10 |
|---|---|---|
| `tach_gas` | 685 269 ± 56 | 685 225 ± 78 |
| `verify_record_gas` | 615 643 ± 56 | 615 599 ± 78 |
| `settle_gas` | 69 626 ± 0 | 69 626 |
| `proof_generation_ms` | 1 229.3 ± 91.6 | 1 236.7 ± 91.5 |
| `setup_ms` | 1 598.6 ± 122.2 | 1 468.7 |

Gas must land inside the spread above. Times are machine- and load-dependent.

### Level 3 — full re-run

```bash
cd backend
THI_NGHIEM=theo_n npm run experiment:lap20     # d = 9, n ∈ {1, 10, 30, 60, 100, 500}
THI_NGHIEM=theo_d npm run experiment:lap20     # d ∈ {1 … 8}, n = 2^d
npm run experiment:lap20:tonghop
```

Duration on the machine in §2 — `theo_n`: Mode A ≈ 2 h, Mode B ≈ 27 h. `theo_d`: Mode A ≈ 1.5 h,
Mode B ≈ 24 h. Run Mode A and Mode B one after the other, never together.

Protocol of one run: Ganache snapshot → 3 warm-up iterations (`warmup = true`, excluded) → `n` measured
iterations → revert. 20 runs per configuration; the order of configurations is shuffled each round with
seed `20260915`. Reported values are mean ± sample SD over `N = 20 · n` iterations, except quantities that
are constant within a run (`update_root_gas`, deployment gas, Mode B `setup_ms`), counted once per run
(`N = 20`); the `cach_dem` column states which rule applies. `theo_d` fills the tree at each depth
(`n = 2^d`) and takes the first `n` students of `dataset_n500.json`; `d = 9` is not re-measured there, it is
the `n = 500` configuration of `theo_n`. The rule for choosing `K` per depth differs between the modes —
see the per-mode README.

To resume after a stop: restart Ganache, then rerun the same command. Runs holding `xong.json` are skipped.

### Other runners

```bash
cd backend
npm run experiment:artifacts                               # → quantitative/artifact_sizes.json
cp experiment.config.example.json experiment.config.json   # fill in wallets from the Ganache mnemonic
npm run experiment:qualitative -- ./experiment.config.json # Ganache + IPFS + MongoDB
npm run experiment:sepolia                                 # needs a funded Sepolia key in .env
```

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

The runners in §4 drive the contracts directly and never touch IPFS or MongoDB. The full protocol — issue a
note, encrypt it to IPFS, publish the root, decrypt, prove, withdraw, and have a replayed nullifier
rejected — is the command sequence in each per-mode README. It needs Ganache, IPFS and MongoDB, and writes
to the database, so point `MONGODB_URI` at a scratch database.

Two environment facts when scripting it:

- Mode B prints one JSON object on stdout; Mode A interleaves MongoDB connection lines, labelled values
  (`STUDENT PUBLIC KEY: 0x04…`) and text reports, so parse it from the first `{` or by regex. Ids are
  `universityId` / `poolId` / `requestId` in Mode A, `_id` in Mode B.
- Windows PowerShell 5.1 prepends a BOM when piping into a child process, so `withdrawal:create` fails with
  `Unexpected token '﻿'`. Setting `$OutputEncoding` does not help; write the JSON to a file and pipe it
  through `cmd`:

  ```powershell
  [IO.File]::WriteAllText($tmp, $submissionJson, (New-Object System.Text.UTF8Encoding $false))
  cmd /c "type `"$tmp`" | npm run --silent withdrawal:create"
  ```

## 6. Which file holds which result

| Paper result | Runner | File |
|---|---|---|
| Gas and time vs. pool size `n` | `experiment:lap20` (`theo_n`) | `quantitative/lap20_1509/theo_n/bang_bai_bao_theo_n.csv`; full statistics in `tong_hop_theo_n.csv` |
| Gas and time vs. depth `d` | `experiment:lap20` (`theo_d`) | `quantitative/lap20_1509/theo_d/bang_bai_bao_theo_d.csv`, `dD/k.json`, `dD/verifier.json` |
| Deployment gas, bytecode vs. EIP-170 | `experiment:artifacts` | `quantitative/artifact_sizes.json` |
| Totals per scholarship round | single-run lot, 12 Sep 2026 | `quantitative/luot_bao_cao/` |
| Qualitative criteria | `experiment:qualitative` | `qualitative/` |
| Sepolia validation | `experiment:sepolia` | `sepolia/kiem_nghiem_sepolia_*.json` / `.csv` |

## 7. Vietnamese names in the data

Code and comments are English; directory names, output file names, CSV columns and environment variables are
Vietnamese, and the runners read them, so they are part of the data format.

**Environment variables**

| Name | Meaning |
|---|---|
| `THI_NGHIEM` | `theo_n` (vary pool size) or `theo_d` (vary depth) |
| `SO_LUOT` | runs per configuration (default 20) |
| `WARMUP` | warm-up iterations per run (default 3) |
| `KICH_BAN` | pool sizes `n` for `theo_n` |
| `DO_SAU` | depths `d` for `theo_d` (default `1,2,3,4,5,6,7,8`) |
| `N_THEO_D` | fixed `n` at every depth; unset ⇒ `n = 2^d` |
| `LUOT` | run only these run numbers, e.g. `1` or `1-3` |
| `HAT_GIONG` | shuffle seed |
| `THU_MUC_LAP` | output root directory |
| `CHI_IN_KE_HOACH=1` | print the plan and exit |
| `BENCH_OUT_DIR`, `BENCH_WARMUP` | Mode B prover: output directory, warm-up count |
| `MERKLE_DEPTH`, `HALO2_K` | Mode A prover: override `d` and `K` (defaults 9, 9) |
| `KIEM_NGHIEM_RPC_URL`, `KIEM_NGHIEM_PRIVATE_KEY`, `KIEM_NGHIEM_PROOFS` | Sepolia: RPC, funded key, alternative proof file |

**Files and folders**

| Name | Contents |
|---|---|
| `lap20_1509/` | the 20-run lot |
| `theo_n/`, `theo_d/` | by pool size / by depth |
| `nN/`, `dD/`, `luotNN/` | configuration `n = N` or `d = D`; run number NN |
| `xong.json` | run-complete marker and run metadata; written last, which is what makes a run resumable |
| `cau_hinh_chay.json` | runs per configuration, warm-up count, shuffle seed, the shuffled order of each round, the `K` chosen and how, plus machine, git commit and SHA-256 of the prover binary |
| `dD/k.json` | every `K` tried at depth `d` and whether it had enough rows |
| `dD/verifier.json` | Mode B: the `K` chosen, verifier bytecode size, share of EIP-170, every attempt |
| `dD/Halo2Verifier.sol`, `dD/Halo2Verifier.artifact.json` | the verifier compiled for that depth |
| `dD/dataset_n<n>_d<d>.json` | Mode B input at that depth |
| `tong_hop_*.csv` | mean, SD, min, max |
| `theo_luot.csv` | per-run means |
| `bang_bai_bao_*.csv` | the mean ± SD table used in the paper |
| `luot_bao_cao/` | single-run lot, 12 Sep 2026 |
| `_luu_tru/` | superseded lots |
| `kiem_nghiem_sepolia_*` | Sepolia evidence |
| qualitative suffixes `tieuchi` · `A-minhbach` · `B-riengtu` · `C3-rangbuoc-amount` · `dieukiendo` · `sinhvien` | criteria · transparency · privacy · amount binding · measurement conditions · per student |

**CSV columns**

| Column | Meaning |
|---|---|
| `thi_nghiem`, `cau_hinh`, `run_id`, `iteration`, `warmup` | experiment, configuration, run, iteration, warm-up flag |
| `d`, `k` | Merkle depth and `K` for that row |
| `R`, `N` | runs contributing, values the statistics cover |
| `cach_dem` | `moi_lan_do` = one value per iteration; `moi_luot` = one value per run |
| `nguon` | source lot (`lap20` or `luot_bao_cao_12_09`) |
| `don_vi` | unit |
| `tach_gas` | Mode B: `verify_record_gas` + `settle_gas` |

## 8. Notes

- Mode A is cheaper per withdrawal because its contract does not verify the proof; the two modes differ in
  trust model, and the proving stacks differ as well (IPA/Pasta vs. KZG/BN254).
- Mode B KZG parameters come from the fixed seed `ChaCha20Rng::from_seed([42u8; 32])`. This is reproducible
  but is not a trusted setup. Mode A (IPA) needs no setup.
- Every key in this repository is a test key; dataset `private_key` fields are Ganache accounts of the
  mnemonic above.
- The contracts are a research prototype and have not been audited.
- Results were produced by the code at tag `<TAG>`.

## 9. Citation and license

`<citation>` · License: `<to be decided>`
