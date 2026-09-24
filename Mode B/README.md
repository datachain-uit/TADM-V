# Mode B — on-chain verification

Shared setup, experiment method and the glossary of Vietnamese names: [`../README.md`](../README.md).

| | |
|---|---|
| Proof system | `halo2-axiom` 0.5.1 + `halo2-base` 0.5.0 + `snark-verifier-sdk` 0.2.3, KZG/SHPLONK over BN254 |
| `K` at `d = 9` | 13 |
| Proof / calldata | 4 224 B / 4 352 B |
| Verifier bytecode | 20 834 B = 84.8 % of the EIP-170 limit |
| Contracts | `ShieldedPool.sol`, `Halo2Verifier.sol` (generated), `MockHalo2Verifier.sol` |
| Contract calls | `verifyAndRecord(proof, root, nullifier, amount, recipient)` then `settle(nullifier)` |
| Prover | one `bench-from-dataset` process per run: keygen once, then warm-up, then `n` proofs |

`ShieldedPool` staticcalls the verifier and pays only if it returns true. `verifyAndRecord` is `onlySchool`,
which governs who submits, not whether the proof is checked.

KZG parameters come from the fixed seed `ChaCha20Rng::from_seed([42u8; 32])` — reproducible, not a trusted
setup.

## Build and test

```bash
cargo build --release -p prover
cd contracts && npm ci && npm run compile && npm test && cd ..     # 34 tests
cd backend   && npm ci && cp .env.example .env && npm run typecheck && npm test && cd ..   # 39 tests
```

The contract tests cover the binding of every public input: a withdrawal reverts when the submitted `root`,
`nullifier`, `amount` or `recipient` differs from the proof, including a valid proof replayed from another
wallet, and when the root was never approved. Two of them read
`experiments/results/quantitative/proofs_n1.json` and `proofs_n10.json`.

## Regenerating the verifier

`contracts/contracts/Halo2Verifier.sol` is generated and bound to the circuit shape — depth, number of
public inputs, `K`. Regenerate only when one of those changes:

```bash
cd backend
../target/release/prover export-verifier                                       # → contracts/contracts/Halo2Verifier.sol
../target/release/prover export-verifier-from-dataset ../experiments/data/dataset_n10.json   # same, at that file's merkle_depth
cd ../contracts && npm run compile && cd ..                                    # then redeploy, see below
```

Deploying is one command, which deploys a fresh `Halo2Verifier` and then a `ShieldedPool` bound to that
verifier's address, and returns both:

```bash
cd backend
npm run pool:deploy -- <poolId> KHTC-01 <fundingWei>
```

The experiment runners deploy their own pair the same way, so they pick up a regenerated verifier without
any extra step.

Re-exporting at `d = 9` reproduces the committed `Halo2Verifier.sol` byte-for-byte. A verifier built for another depth rejects every proof. Before measuring, the LAP20 runner compares the file
on disk with the version in git HEAD, so the working copy must be a git checkout (`git init` is enough); on a
mismatch it stops before measuring. The `theo_d` sweep regenerates one verifier per depth, then restores the
`d = 9` verifier and checks its bytecode is byte-identical to the original.

## `K` in the depth sweep

The smallest `K` whose verifier still fits EIP-170 (≤ 24 576 B deployed) — not the smallest `K` that builds.
A smaller `K` does not fail in halo2-base; it is answered with more advice columns, which inflate the
verifier. Measured at `d = 1`: `K = 10` has enough rows but yields a 31 110 B verifier, over the limit, while
`K = 11` yields 20 806 B. Every attempt is recorded in
`experiments/results/quantitative/lap20_1509/theo_d/dD/verifier.json`.

## Runners

```bash
cd backend
npm run experiment:lap20:tonghop                   # rebuild the tables
THU_MUC_LAP=experiments/results/quantitative/lap20_rerun THI_NGHIEM=theo_n npm run experiment:lap20   # ~27 h
THU_MUC_LAP=experiments/results/quantitative/lap20_rerun THI_NGHIEM=theo_d npm run experiment:lap20   # ~24 h
THU_MUC_LAP=experiments/results/quantitative/lap20_rerun npm run experiment:lap20:tonghop               # tables of that re-run
npm run experiment:prepare                         # regenerates experiments/data/dataset_n*.json; needs IPFS
npm run experiment:proofs                          # regenerates proofs AND rewrites Halo2Verifier.sol
npm run experiment:gas                             # ~5–7 min, Ganache only
npm run experiment:artifacts
npm run experiment:qualitative -- ./experiment.config.json
```

The six datasets ship with the artifact, so `experiment:prepare` is not part of reproducing anything: it
exists to build them in the first place. Each record it writes carries a fresh `rho`, a note encrypted to
IPFS and that note's CID, which is why it refuses to overwrite — Mode A holds byte-identical copies of the
same six files and has no such command.

Run `npm run compile` and redeploy between `experiment:proofs` and `experiment:gas`, otherwise gas is
measured against the previous verifier. `generateAllProofs.ts` checks `EXPECTED_CALLDATA_BYTES` (4 352); a
stale value makes it skip every scenario.

Where each command writes, under `experiments/results/`:

| Command | Output |
|---|---|
| `THU_MUC_LAP=…/lap20_rerun … experiment:lap20` | `quantitative/lap20_rerun/<theo_n\|theo_d>/<nN\|dD>/luotNN/`, one directory per run, with that run's `prover.log` |
| `THU_MUC_LAP=…/lap20_rerun … experiment:lap20:tonghop` | `quantitative/lap20_rerun/`, next to the re-run |
| `experiment:lap20:tonghop` | `quantitative/lap20_1509/` — the published lot |
| `experiment:prepare` | `../experiments/data/dataset_n<n>.json`, one per scenario. It **skips any file that already exists**, so the six shipped datasets are never rewritten |
| `experiment:proofs` | `quantitative/proofs_n*.json`, `performance_onchain_n*.csv`, and rewrites `contracts/contracts/Halo2Verifier.sol` |
| `experiment:gas` | `quantitative/gas_onchain_n*.csv`, `gas_onchain_raw.csv` |
| `experiment:artifacts` | `quantitative/artifact_sizes.json`, in place; the sizes are deterministic, only `metadata.measured_at` changes |
| `experiment:qualitative` | `qualitative/qualitative-onchain-n<N>-<timestamp>.json` and six CSVs with the same prefix: `-tieuchi`, `-A-minhbach`, `-B-riengtu`, `-C3-rangbuoc-amount`, `-dieukiendo`, `-sinhvien`. With `studentCount` 1 the `-n<N>` part and the `-A-`, `-B-`, `-sinhvien` files are omitted. A new set per run; the published one is never touched |

`THU_MUC_LAP` redirects both `experiment:lap20` and `experiment:lap20:tonghop`. Without it, `experiment:lap20`
targets `quantitative/lap20_1509/`, where every run already has `xong.json`, and skips them all.

## Which files the paper quotes

Every Mode B figure in the paper comes from one of these. The runners overwrite results in place, so a test
run must be redirected with `THU_MUC_LAP` (see the root README §4, Level 2).

| Figure in the paper | File | Where in it |
|---|---|---|
| Withdrawal gas, proof generation time and verification time per pool size `n` | `experiments/results/quantitative/lap20_1509/theo_n/bang_bai_bao_theo_n.csv` | `tach_gas` is the withdrawal (`verify_record_gas` + `settle_gas`); also `proof_generation_ms`, `verify_onchain_ms` |
| The same per Merkle depth `d`, with `k` and the verifier size | `experiments/results/quantitative/lap20_1509/theo_d/bang_bai_bao_theo_d.csv` | one row per `d`; the chosen `k`, its bytecode size and every attempt are in `theo_d/dD/verifier.json` |
| Full statistics behind both tables | `.../theo_n/tong_hop_theo_n.csv`, `.../theo_d/tong_hop_theo_d.csv` | mean, SD, min, max, `R`, `N`, `cach_dem` per metric |
| Per-run means | `.../theo_n/nN/theo_luot.csv`, `.../theo_d/dD/theo_luot.csv` | one row per run |
| How the lot was run | `.../lap20_1509/cau_hinh_chay.json` | runs per configuration, warm-up count, shuffle seed, round order, machine, prover binary hash |
| Pool deployment 1 979 758, verifier deployment 4 554 511, verifier 20 834 B, pool 8 697 B | `experiments/results/quantitative/artifact_sizes.json` | `block_gas.deploy_pool.mean`, `block_gas.deploy_verifier.mean`, `verifier_contract.deployed_bytecode_bytes`, `pool_contract.deployed_bytecode_bytes` |
| Totals per scholarship round | `experiments/results/quantitative/luot_bao_cao/` | the single-run lot of 12 Sep 2026 |
| Sepolia deployment and withdrawals | `experiments/results/sepolia/kiem_nghiem_sepolia_2026-09-12T06-08-05.json` | addresses, gas, transaction hashes; the `.csv` beside it is the same run |
| Qualitative criteria | `experiments/results/qualitative/qualitative-onchain-n500-2026-09-12T23-03-03-358Z-tieuchi.csv` | one row per criterion and evidence item, with its verdict |

## End-to-end flow

Start the three services first, each in its own terminal:

```bash
ganache --wallet.totalAccounts 501 --wallet.mnemonic "test test test test test test test test test test test junk"
ipfs daemon
mongod --dbpath <your data directory>     # or any MongoDB reachable from this machine
```

MongoDB Community installs as a service that already listens on 27017, so the `mongod` line above is only
for a manual instance: `winget install MongoDB.Server` on Windows, `brew install mongodb-community` on
macOS, or the distribution package on Linux.

`backend/.env`, copied from `.env.example`, points at `mongodb://127.0.0.1:27017/`, `http://127.0.0.1:8545`
and `127.0.0.1:5001`. Edit `MONGODB_URI` if your MongoDB is somewhere else. No private keys are needed: the
wallets come from the Ganache mnemonic above. Check the database connection before starting:

```bash
cd backend
npm run db:test      # prints the database and host it reached
```

`accounts[0]` = university, `accounts[1]` = sponsor, `accounts[2]` = student. `university:create` seeds the
two staff accounts `CTSV-01` (student affairs) and `KHTC-01` (finance); each `<…>` comes from the previous
command's output.

```bash
cd backend
npm run flow:reset

npm run university:create   -- "CLI University" <universityAddress>
npm run student:create      -- <universityId> CTSV-01 24560003 student@example.edu
npm run student:eligibility -- <universityId> CTSV-01 24560003 approve
npm run student:finance     -- <universityId> KHTC-01 24560003 100000000000000000

npm run pool:create  -- <universityId> KHTC-01
npm run pool:deploy  -- <poolId> KHTC-01 1000000000000000000
npm run pool:fund    -- <poolId> KHTC-01 500000000000000000 <sponsorAddress>
npm run pool:balance -- <poolId>

npm run student:pubkey -- <notePrivateKey>
npm run student:wallet -- <universityId> CTSV-01 <poolId> student@example.edu <studentAddress> <publicKey>
npm run scholarship:issue -- <universityId> CTSV-01 24560003
npm run root:approve      -- <poolId> CTSV-01

npm run note:decrypt -- <cid> <notePrivateKey> | npm run withdrawal:create
npm run withdrawal:review -- <requestId> KHTC-01 approve
npm run withdrawal:review -- <requestId> KHTC-01 approve      # must fail
```

Expected output:

| Step | Result |
|---|---|
| `pool:deploy` | status `DEPLOYED`, `contractAddress` and `verifierAddress` returned |
| `pool:fund` | `balanceWei 1500000000000000000` (1 ETH initial + 0.5 ETH sponsor) |
| `scholarship:issue` | status `NOTE_CREATED`, IPFS CID, commitment |
| `root:approve` | `Merkle nodes saved: 10` at `depth: 9`, root published |
| `withdrawal:create` | proof generated, status `PENDING_APPROVAL`, nullifier returned |
| `withdrawal:review` 1st | status `EXECUTED`, `settleGas` 69 614 – 69 626, `usedNullifier true`, balance 1.5 → 1.4 ETH |
| `withdrawal:review` 2nd | `Transaction has been reverted by the EVM`, receipt `status "0"` |

`settleGas` varies by a few tens of gas around the benchmark mean (69 626): the calldata byte pattern
depends on `amount` and `recipient`.

## Output format

One `JSON.stringify(…, null, 2)` object on stdout, debug text on stderr, non-zero exit on failure, so
`| ConvertFrom-Json` and `| jq` work directly. Ids are `_id`.

`withdrawal:create` reads stdin; on Windows PowerShell 5.1 pipe it through `cmd` — see the root README, §5.
