# Mode A — off-chain verification

Shared setup, experiment method and the glossary of Vietnamese names inside the data files:
[`../README.md`](../README.md).

| | |
|---|---|
| Proof system | `halo2_proofs` 0.3.2, IPA over Pasta — no trusted setup |
| `K` at `d = 9` | 9; parameters in `shared/params.bin` |
| Proof size | 3 104 B |
| Contracts | `ShieldedPool.sol`; no verifier contract |
| Contract call | `withdrawOffChain(root, nullifier, recipient, amount)` — takes no proof |
| Prover | in the flow, one process per proof and per verification; in the published 20-run lot, one `prove-batch` process per run |

The backend generates the proof, verifies it and then calls the contract, which checks the root and the
nullifier and pays. Changing the circuit needs no redeployment: the verifying key is rebuilt on every `prove` /
`verify`. `proof_bytes` stays 3 104 B across circuit changes, so cached `proofs_offchain_n*.json` must be deleted
by hand after a circuit change.

## Build and test

```bash
cargo build --release -p prover
cd contracts  && npm ci && npm run compile && npm test && cd ..     # 15 tests (InsiderTrust.js: the university insider)
cd backend    && npm ci && cp .env.example .env && npm run typecheck && npm test && cd ..   # 61 tests
cargo test --release --workspace --locked                            # 8 tests, generates real proofs
cd client-web && npm ci && npm test && cd ..                        # 12 tests (vitest)
```

`cargo test` covers 5 circuit tests in `circuits/src/merkle_tree.rs` (a sixth, a timing benchmark, is
`#[ignore]`d), `prover/tests/proof_smoke.rs` (a real proof from a fixture) and `prover/tests/verify_gate.rs` (a
tampered public input and a forged note are both rejected by `verify`).

`npm run deploy:ganache` in `contracts/` deploys a standalone `ShieldedPool` with `scripts/deploy.js`;
`INITIAL_FUNDING_WEI` (default 1 ETH) and `DENOMINATION_WEI` (the pool's fixed withdrawal amount, default 0 =
any amount) configure it. The backend and the runners deploy their own pools and do not use it.

## Prover CLI

```
setup | check-k | rho | commitment | nullifier | root | prove | prove-batch | verify
```

| Mode | Output |
|---|---|
| `prove` | proof plus `tree_and_witness_ms`, `setup_ms`, `prove_ms`, `total_ms` |
| `verify` | `{verified, setup_ms, verify_ms}`; building the verifying key is charged to `setup_ms` |
| `prove-batch` | reads a JSON array of students, runs keygen once, then proves and verifies each in the same process; used by `PROVER_MODE=warm` |
| `check-k` | runs `keygen_vk` on a shape-only circuit; exits non-zero on `NotEnoughRowsAvailable` |
| `rho` | one field element, rejection-sampled on `OsRng` |

The prover's parameter paths are relative to `backend/`, so run it from there:

```bash
cd backend
echo '{}' | ../target/release/prover rho
echo '{"student_id":24560003,"amount":"100000000000000000","rho":"12345678901234567890"}' | ../target/release/prover commitment
```

`commitment` and `nullifier` read `{student_id, amount, rho}` on stdin; `root` also needs `commitments`
and `merkle_index`.

`MERKLE_DEPTH` and `HALO2_K` override `d` and `K` (defaults 9, 9). A `K` other than 9 writes its parameters
to `target/params_k<K>.bin`. `setup` regenerates `shared/params.bin` byte-identically; `check-k` answers
`{"k":9,"merkle_depth":9,"ok":true,…}` at `K = 9` and exits 101 with `NotEnoughRowsAvailable` at `K = 8`.

## `K` in the depth sweep

The smallest `K` that still has enough rows: the runner probes upward from `K = 4` with `check-k`, so every
smaller `K` has been tried and failed. Every attempt is recorded in
`experiments/results/quantitative/repeated_runs/by_depth/dD/k.json`.

## Runners

```bash
cd backend
npm run experiment:repeated:summary                               # rebuild the tables
PROVER_MODE=warm EXPERIMENT=by_n npm run experiment:repeated      # ~2 h, writes to quantitative/repeated_runs_warm/
PROVER_MODE=warm EXPERIMENT=by_depth npm run experiment:repeated  # ~1.5 h
RUNS_DIR=experiments/results/quantitative/repeated_runs_warm npm run experiment:repeated:summary   # tables of that re-run
npm run experiment:quantitative                    # single-run lot; SCENARIOS=1,10 restricts it
npm run experiment:artifacts
npm run experiment:qualitative -- ./experiment.config.json
```

Where each command writes, under `experiments/results/`:

| Command | Output |
|---|---|
| `PROVER_MODE=warm … experiment:repeated` | `quantitative/repeated_runs_warm/<by_n\|by_depth>/<nN\|dD>/runNN/`, one directory per run |
| `experiment:repeated:summary` | `quantitative/repeated_runs/` — the published lot |
| `RUNS_DIR=…/repeated_runs_warm … experiment:repeated:summary` | `quantitative/repeated_runs_warm/`, next to the re-run |
| `experiment:quantitative` | `quantitative/gas_offchain_n*.csv`, `gas_offchain_raw.csv`, `performance_offchain_n*.csv`, `proofs_offchain_n*.json` |
| `experiment:artifacts` | `quantitative/artifact_sizes.json`, in place; the bytecode sizes are deterministic and the gas figures are read from `gas_offchain_raw.csv`, so only the `metadata` block (time, commit, machine) changes |
| `experiment:qualitative` | `qualitative/qualitative-n<N>-<timestamp>.json` and six CSVs with the same prefix: `-criteria`, `-A-transparency`, `-B-privacy`, `-C3-amount-binding`, `-measurement-conditions`, `-students`. With `studentCount` 1 the `-n<N>` part and the `-students` file are omitted. A new set per run; the published one is never touched |

`RUNS_DIR` redirects both `experiment:repeated` and `experiment:repeated:summary`. `PROVER_MODE` is `cold`
(the default: a new prover process for every proof and every verification) or `warm` (one `prove-batch` process
per run, the setting the published lot was measured with). Without `PROVER_MODE=warm`, `experiment:repeated`
targets `quantitative/repeated_runs/`, where every run already has `done.json`, and skips them all.

## Which files the paper quotes

Every Mode A figure in the paper comes from one of these. The runners overwrite results in place, so a test
run must be redirected with `RUNS_DIR` (see the root README §4, Level 2).

| Figure in the paper | File | Where in it |
|---|---|---|
| Withdrawal gas, proof generation time and verification time per pool size `n` | `experiments/results/quantitative/repeated_runs/by_n/paper_table_by_n.csv` | columns `withdraw_gas`, `proof_generation_ms`, `verify_native_ms`; one row per `n` |
| The same per Merkle depth `d`, with `k` | `experiments/results/quantitative/repeated_runs/by_depth/paper_table_by_depth.csv` | one row per `d`; the `k` probe behind each row is `by_depth/dD/k.json` |
| Full statistics behind both tables | `.../by_n/summary_by_n.csv`, `.../by_depth/summary_by_depth.csv` | mean, SD, min, max, `R`, `N`, `cach_dem` per metric |
| Per-run means | `.../by_n/nN/per_run.csv`, `.../by_depth/dD/per_run.csv` | one row per run and metric |
| How the lot was run | `.../repeated_runs/run_config.json` | runs per configuration, warm-up count, shuffle seed, round order, machine, prover binary hash |
| Pool deployment gas 968 565 and pool bytecode 4 121 B | `experiments/results/quantitative/artifact_sizes.json` | `block_gas.deploy_pool.mean`, `pool_contract.deployed_bytecode_bytes` |
| Totals per scholarship round | `experiments/results/quantitative/report_run/` | the single-run lot of 12 Sep 2026 |
| Sepolia deployment and withdrawals | `experiments/results/sepolia/validation_sepolia_2026-09-12T06-10-28.json` | addresses, gas, transaction hashes; the `.csv` beside it is the same run |
| Qualitative criteria | `experiments/results/qualitative/qualitative-n500-2026-09-12T22-07-43-781Z-criteria.csv` | one row per criterion and evidence item, with its verdict |

The published tables keep the column names and labels they were written with (`thi_nghiem`, `cau_hinh`,
`cach_dem`, `nguon`, `theo_n` / `theo_d`, …); the root README §7 translates them.

The deployment gas 968 565 was measured before the comments were removed from `ShieldedPool.sol`. The contract
compiled from this repository differs only in its metadata hash and deploys for 12 gas less (root README §8);
its bytecode size and the withdrawal gas are unchanged.

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

`backend/.env`, copied from `.env.example`, points at `mongodb://127.0.0.1:27017/scholarship_zkp`,
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

npm run university:create   -- "Demo University" <universityAddress>
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
file passed as its argument, builds the witness, has the Rust prover generate the proof, verifies it off-chain
and stores the request.

Expected output (fields of the JSON on stdout):

| Step | Result |
|---|---|
| `pool:deploy` | `status` `DEPLOYED`, `deploymentGasUsed` 12 gas below the published 968 565 (see above) |
| `pool:fund` | `balanceWei` `1500000000000000000` (1 ETH initial + 0.5 ETH sponsor) |
| `student:wallet` | `status` `WALLET_REGISTERED` |
| `scholarship:issue` | `status` `NOTE_CREATED`, `encryptedNoteCid`, `commitment` computed by the prover |
| `root:approve` | root published, `rootUpdateGasUsed` `73092` at `n = 1`, `validRoot` true |
| `withdrawal:create` | `status` `PENDING_APPROVAL`, `localVerificationPassed` true, `nullifier`, request `id` |
| `withdrawal:review` 1st | re-verifies, `status` `EXECUTED`, `withdrawGasUsed` 64 703 – 64 715, `usedNullifier` true, balance 1.5 → 1.4 ETH (`poolBalanceBeforeWei` → `poolBalanceAfterWei`) |
| `withdrawal:review` 2nd | the contract reverts the replayed nullifier (its `require` reason is `nullifier already used`); the command prints `Transaction has been reverted by the EVM` with the receipt (`status` `0`) — the reason string is not in that message — and exits with code 1 |

`root:approve` gas is exact. The per-withdrawal gas varies by a few tens of gas around the benchmark mean
(64 665 ± 5): the calldata byte pattern depends on `amount` and `recipient`.

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
`{ "universityId": … }`, `{ "poolId": … }` or `{ "publicKey": … }`, never a raw database document. MongoDB
connection lines and progress go to stderr; on failure only the error message is printed and the exit code is
non-zero. Ids are `universityId`, `poolId`, and `id` for a withdrawal request.
