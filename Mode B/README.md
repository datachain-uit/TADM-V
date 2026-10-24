# Mode B — on-chain verification

Shared setup and experiment method:
[`../README.md`](../README.md).

| | |
|---|---|
| Proof system | `halo2-axiom` 0.5.1 + `halo2-base` 0.5.0 + `snark-verifier-sdk` 0.2.3, KZG/SHPLONK over BN254 |
| `K` at `d = 9` | 13 |
| Proof / calldata | 4 224 B / 4 352 B |
| Verifier bytecode | 20 834 B = 84.8 % of the EIP-170 limit |
| Contracts | `ShieldedPool.sol`, `Halo2Verifier.sol` (generated), `MockHalo2Verifier.sol` |
| Contract calls | `verifyAndRecord(proof, root, nullifier, amount, recipient)` then `settle(nullifier)` |
| Prover | in the flow, one process per proof; in the published 20-run lot, one `bench-from-dataset` process per run: keygen once, then warm-up, then `n` proofs |

`ShieldedPool` staticcalls the verifier and pays only if it returns true. `verifyAndRecord` is `onlySchool`,
which governs who submits, not whether the proof is checked.

KZG parameters come from the fixed seed `ChaCha20Rng::from_seed([42u8; 32])` — reproducible, not a trusted
setup.

## Build and test

```bash
cargo build --release -p prover
cd contracts  && npm ci && npm run compile && npm test && cd ..     # 39 tests (InsiderDiversion.js: the university insider with a real proof)
cd backend    && npm ci && cp .env.example .env && npm run typecheck && npm test && cd ..   # 63 tests
cargo test --release --workspace --locked                            # 9 circuit tests
cd client-web && npm ci && npm test && cd ..                        # 12 tests (vitest)
```

The contract tests cover the binding of every public input: a withdrawal reverts when the submitted `root`,
`nullifier`, `amount` or `recipient` differs from the proof, including a valid proof replayed from another
wallet, and when the root was never approved. `ClaimBinding.js`, `Halo2VerifierGate.js` and `PoolIsolation.js`
read `experiments/results/quantitative/proofs_n1.json` and `proofs_n10.json`.

`cargo test` runs the unit tests in `circuits/src/` (`commitment.rs`, `merkle_tree.rs`, `note.rs`,
`poseidon.rs`).

## Regenerating the verifier

`contracts/contracts/Halo2Verifier.sol` is generated and bound to the circuit shape — depth, number of
public inputs, `K`. Regenerate only when one of those changes:

```bash
cd backend
../target/release/prover export-verifier                                       # → contracts/contracts/Halo2Verifier.sol
../target/release/prover export-verifier-from-dataset ../experiments/data/dataset_n10.json   # same, at that file's merkle_depth
cd ../contracts && npm run compile && cd ..                                    # then redeploy, see below
```

The exporter drops the comment lines of the generated Solidity and keeps the SPDX line. Re-exporting at
`d = 9` reproduces the committed `Halo2Verifier.sol` byte-for-byte. The file is written to an absolute path
fixed when the prover is compiled, so the command overwrites this repository's file whatever directory it is
run from.

Deploying is one command, which deploys a fresh `Halo2Verifier` and then a `ShieldedPool` bound to that
verifier's address, and returns both:

```bash
cd backend
npm run pool:deploy -- <poolId> KHTC-01 <fundingWei>
```

The experiment runners deploy their own pair the same way, so they pick up a regenerated verifier without
any extra step. `contracts/scripts/deploy.js` (`npx hardhat run scripts/deploy.js --network ganache`) deploys a
standalone pair; the pool's fixed withdrawal amount is `DENOMINATION_WEI` (default 0 = any amount).

A verifier built for another depth rejects every proof. Before measuring, `experiment:repeated` compares the
file on disk with the version in git HEAD, so the working copy must be a git checkout (`git init` is enough);
on a mismatch it stops before measuring. The `by_depth` sweep regenerates one verifier per depth, then restores
the `d = 9` verifier and checks its bytecode is byte-identical to the original.

## `K` in the depth sweep

The smallest `K` whose verifier still fits EIP-170 (≤ 24 576 B deployed) — not the smallest `K` that builds.
A smaller `K` does not fail in halo2-base; it is answered with more advice columns, which inflate the
verifier. Measured at `d = 1`: `K = 10` has enough rows but yields a 31 110 B verifier, over the limit, while
`K = 11` yields 20 806 B. Every attempt is recorded in
`experiments/results/quantitative/repeated_runs/by_depth/dD/verifier.json`. At `d = 7` the sweep started
directly at `K = 13`; `by_depth/d7/k_remeasured_0917.json` records the follow-up measurement in which `K = 11`
and `K = 12` both fail. In the sweep `d = 16 … 24` every depth needs `K = 14`: at `K = 13` the verifier for
`d = 16` is 25 255 B, over the limit.

## Runners

```bash
cd backend
npm run experiment:repeated:summary                # rebuild the tables
RUNS_DIR=experiments/results/quantitative/repeated_runs_rerun EXPERIMENT=by_n npm run experiment:repeated       # ~27 h
RUNS_DIR=experiments/results/quantitative/repeated_runs_rerun EXPERIMENT=by_depth npm run experiment:repeated   # ~24 h
RUNS_DIR=experiments/results/quantitative/repeated_runs_rerun npm run experiment:repeated:summary                # tables of that re-run
npm run experiment:prepare                         # regenerates experiments/data/dataset_n*.json; needs IPFS
npm run experiment:proofs                          # regenerates proofs AND rewrites Halo2Verifier.sol
npm run experiment:gas                             # ~5–7 min, Ganache only; SCENARIOS=1,10 restricts it
npm run experiment:artifacts
npm run experiment:qualitative -- ./experiment.config.json
EXPERIMENT=by_depth DEPTHS=9,16,17,18,19,20,21,22,23,24 N_PER_DEPTH=100 RUNS=20 RUNS_DIR=experiments/results/quantitative/depth_sweep_n100 npm run experiment:repeated   # ~42 h
npm run experiment:insider-proof                  # → experiments/results/insider/diverted_proof_n1.json
cd ../contracts && npx hardhat run scripts/insiderExperiment.js   # → experiments/results/insider/insider_onchain.csv
```

The six datasets ship with the artifact, so `experiment:prepare` is not part of reproducing anything: it
exists to build them in the first place. Each record it writes carries a fresh `rho`, a note encrypted to
IPFS and that note's CID, which is why it refuses to overwrite — Mode A holds byte-identical copies of the
same six files and has no such command.

Run `npm run compile` after `experiment:proofs`, before anything that touches the verifier:
`experiment:gas`, or gas is measured against the previous verifier, and `experiment:repeated`, which compares
`Halo2Verifier.sol` against the git HEAD version and stops if they disagree. `generateAllProofs.ts` checks
`EXPECTED_CALLDATA_BYTES` (4 352); a stale value makes it skip every scenario.

Where each command writes, under `experiments/results/`:

| Command | Output |
|---|---|
| `RUNS_DIR=…/repeated_runs_rerun … experiment:repeated` | `quantitative/repeated_runs_rerun/<by_n\|by_depth>/<nN\|dD>/runNN/`, one directory per run, with that run's `prover.log` |
| `RUNS_DIR=…/repeated_runs_rerun … experiment:repeated:summary` | `quantitative/repeated_runs_rerun/`, next to the re-run |
| `experiment:repeated:summary` | `quantitative/repeated_runs/` — the published lot |
| `experiment:prepare` | `../experiments/data/dataset_n<n>.json`, one per scenario. It **skips any file that already exists**, so the six shipped datasets are never rewritten |
| `experiment:proofs` | `quantitative/proofs_n*.json`, `performance_onchain_n*.csv`, and rewrites `contracts/contracts/Halo2Verifier.sol` |
| `experiment:gas` | `quantitative/gas_onchain_n*.csv`, `gas_onchain_raw.csv` |
| `experiment:artifacts` | `quantitative/artifact_sizes.json`, in place; the bytecode sizes are deterministic and the gas figures are read from `gas_onchain_raw.csv`, so only the `metadata` block (time, commit, machine) changes |
| `experiment:qualitative` | `qualitative/qualitative-onchain-n<N>-<timestamp>.json` and six CSVs with the same prefix: `-criteria`, `-A-transparency`, `-B-privacy`, `-C3-amount-binding`, `-measurement-conditions`, `-students`. With `studentCount` 1 the `-n<N>` part and the `-students` file are omitted. A new set per run; the published one is never touched |

`RUNS_DIR` redirects both `experiment:repeated` and `experiment:repeated:summary`. Without it,
`experiment:repeated` targets `quantitative/repeated_runs/`, where every run already has `done.json`, and skips
them all.

## Which files the paper quotes

Every Mode B figure in the paper comes from one of these. The runners overwrite results in place, so a test
run must be redirected with `RUNS_DIR` (see the root README §4, Level 2).

| Figure in the paper | File | Where in it |
|---|---|---|
| Withdrawal gas, proof generation time and verification time per pool size `n` | `experiments/results/quantitative/repeated_runs/by_n/paper_table_by_n.csv` | withdrawal gas = `verify_record_gas` + `settle_gas`; also `proof_generation_ms`, `verify_onchain_ms` |
| The same per Merkle depth `d`, with `k` and the verifier size | `experiments/results/quantitative/repeated_runs/by_depth/paper_table_by_depth.csv` | one row per `d`; the chosen `k`, its bytecode size and every attempt are in `by_depth/dD/verifier.json` |
| Full statistics behind both tables | `.../by_n/summary_by_n.csv`, `.../by_depth/summary_by_depth.csv` | mean, SD, min, max, `R`, `N` and the counting rule per metric |
| Per-run means | `.../by_n/nN/per_run.csv`, `.../by_depth/dD/per_run.csv` | one row per run and metric |
| How the lot was run | `.../repeated_runs/run_config.json` | runs per configuration, warm-up count, shuffle seed, round order, machine, prover binary hash |
| Pool deployment 1 979 758, verifier deployment 4 554 511, verifier 20 834 B, pool 8 697 B | `experiments/results/quantitative/artifact_sizes.json` | `block_gas.deploy_pool.mean`, `block_gas.deploy_verifier.mean`, `verifier_contract.deployed_bytecode_bytes`, `pool_contract.deployed_bytecode_bytes` |
| Totals per scholarship round | `experiments/results/quantitative/report_run/` | the single-run lot of 12 Sep 2026 |
| Sepolia deployment and withdrawals | `experiments/results/sepolia/validation_sepolia_2026-09-12T06-08-05.json` | addresses, gas, transaction hashes; the `.csv` beside it is the same run |
| Qualitative criteria | `experiments/results/qualitative/qualitative-onchain-n500-2026-09-12T23-03-03-358Z-criteria.csv` | one row per criterion and evidence item, with its verdict |
| Depth sweep `d = 16 … 24`, `n = 100` *(added after the paper)* | `experiments/results/quantitative/depth_sweep_n100/by_depth/paper_table_by_depth.csv` | one row per `d`, `d9` is the anchor; `K` = 14 for `d = 16 … 24`, verifier sizes in `dD/verifier.json` |
| University insider *(added after the paper)* | `experiments/results/insider/insider_onchain.csv` | one row per step; `payouts: 1` in the `summary` row |
| Sepolia, 500 withdrawals *(added after the paper)* | `experiments/results/sepolia/validation_sepolia.json`, `sepolia/run_sepolia/withdrawals.csv` | the run of 23 Oct 2026 |

The deployment figures were measured before the comments were removed from the contracts. Compiled from this
repository, `Halo2Verifier` differs only in its metadata hash and deploys for 4 554 499 gas instead of 4 554 511;
`ShieldedPool` deploys for the same gas as published. Bytecode sizes and withdrawal gas are unchanged (root
README §7).

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

`backend/.env`, copied from `.env.example`, points at `mongodb://127.0.0.1:27017/scholarship_zkp_onchain`,
`http://127.0.0.1:8545` and `127.0.0.1:5001`. Edit `MONGODB_URI` if your MongoDB is somewhere else. No private
keys are needed: the wallets come from the Ganache mnemonic above. Check the database connection before starting:

```bash
cd backend
npm run db:test      # prints the database and host it reached
```

`accounts[0]` = university, `accounts[1]` = sponsor, `accounts[2]` = student. `university:create` seeds the
two staff accounts `CTSV-01` (Student Affairs Office) and `KHTC-01` (Finance Office); each `<…>` comes from the
previous command's output. `<notePrivateKey>` is the student's note key, a secp256k1 private key in hex;
`student:pubkey` prints the matching public key, which Student Affairs registers with the wallet.

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

npm run note:decrypt -- <encryptedNoteCid> <notePrivateKey> | npm run withdrawal:create
npm run withdrawal:review -- <id> KHTC-01 approve
npm run withdrawal:review -- <id> KHTC-01 approve      # must fail
```

`student:wallet` takes six arguments — `<universityId> <staffId> <poolId> <email> <wallet> <publicKey>` — and
refuses a student who has not passed both eligibility and finance approval. `note:decrypt` prints `{cid, note}`
(or writes it to a file given as a third argument); `withdrawal:create` reads that object from stdin or from a
file passed as its argument, builds the witness, has the Rust prover generate the proof and submits it to
`verifyAndRecord`, where `Halo2Verifier` checks it on-chain.

Expected output (fields of the JSON on stdout):

| Step | Result |
|---|---|
| `pool:deploy` | `status` `DEPLOYED`, `contractAddress` and `verifierAddress` returned |
| `pool:fund` | `balanceWei` `1500000000000000000` (1 ETH initial + 0.5 ETH sponsor) |
| `student:wallet` | `status` `WALLET_REGISTERED` |
| `scholarship:issue` | `status` `NOTE_CREATED`, `encryptedNoteCid`, `commitment` |
| `root:approve` | root published, `validRoot` true; stderr shows `Merkle nodes saved: 10 \| depth: 9` |
| `withdrawal:create` | proof generated and checked on-chain, `status` `PENDING_APPROVAL`, `verifierChecked` true, `calldataBytes` 4352, `nullifier`, request `id` |
| `withdrawal:review` 1st | `status` `EXECUTED`, `settleGas` 69 614 – 69 626, `usedNullifier` true, balance 1.5 → 1.4 ETH (`poolBalanceBeforeWei` → `poolBalanceAfterWei`) |
| `withdrawal:review` 2nd | the contract reverts the replayed nullifier (its `require` reason is `nullifier already used`); the command prints `Transaction has been reverted by the EVM` with the receipt (`status` `0`) — the reason string is not in that message — and exits with code 1 |

`settleGas` varies by a few tens of gas around the benchmark mean (69 626): the calldata byte pattern
depends on `amount` and `recipient`.

## Web pages

The same flow can be driven from the two web pages (root README §5). Both proxy `/api` to the backend on port
3001; start it first with `npm run api:start` in `backend/` (`NETWORK=ganache` reads `backend/.env.ganache`).

- `admin-web/` — Student Affairs Office and Finance Office (port 3002). Staff sign in with the password set by
  `npm run staff:password`.
- `client-web/` — student (port 3000). The student generates the note key pair in the browser and keeps it in an
  encrypted backup file; only the wallet address and the note public key are handed to the Student Affairs Office.
  To withdraw, the page downloads the encrypted note, decrypts it in the browser and sends the decrypted note to
  the university backend, which builds the witness and generates the Halo2 proof (server-side proving, as in the
  paper). The private keys and the backup password never leave the page.

```bash
cd admin-web  && npm ci && npm run dev
cd client-web && npm ci && npm run dev
```

Checks — `admin-web/`: `npx tsc -b`, `npm run lint`, `npm run build`. `client-web/`: `npx tsc -b`, `npm run lint`,
`npm test` (vitest: note decryption against a backend-made envelope, import boundary, network boundary); end to
end against a running server on Ganache: `npx vite-node scripts/check-student-flow.ts`.

## Output format

Every command prints one `JSON.stringify(…, null, 2)` object on stdout — a compact result such as
`{ "universityId": … }`, `{ "poolId": … }` or `{ "publicKey": … }`, never a raw database document — so
`| ConvertFrom-Json` and `| jq` work directly. MongoDB connection lines and progress go to stderr; on failure
only the error message is printed and the exit code is non-zero. Ids are `universityId`, `poolId`, and `id` for a
withdrawal request.

`withdrawal:create` reads stdin or a file; on Windows PowerShell 5.1 a file is the simplest route — see the root
README, §5.
