# Mode A — off-chain verification

Shared setup, experiment method and the glossary of Vietnamese names: [`../README.md`](../README.md).

| | |
|---|---|
| Proof system | `halo2_proofs` 0.3.2, IPA over Pasta — no trusted setup |
| `K` at `d = 9` | 9; parameters in `shared/params.bin` |
| Proof size | 3 104 B |
| Contracts | `ShieldedPool.sol`; no verifier contract |
| Contract call | `withdrawOffChain(root, nullifier, recipient, amount)` — takes no proof |
| Prover | one process per proof and per verification |

The backend verifies the proof and then calls the contract, which checks the root and the nullifier and
pays. Changing the circuit needs no redeployment: the verifying key is rebuilt on every `prove` / `verify`.
`proof_bytes` stays 3 104 B across circuit changes, so cached `proofs_offchain_n*.json` must be deleted by
hand after a circuit change.

## Build and test

```bash
cargo build --release -p prover
cd contracts && npm ci && npm run compile && npm test && cd ..     # 9 tests
cd backend   && npm ci && cp .env.example .env && npm run typecheck && npm test && cd ..   # 37 tests
cargo test --workspace --locked                                     # 3 tests, generates a real proof
```

`cargo test` covers `proof_smoke.rs` (a real proof from a fixture) and `verify_gate.rs` (a tampered public
input and a forged note are both rejected by `verify`).

## Prover CLI

```
setup | check-k | rho | commitment | nullifier | root | prove | verify
```

| Mode | Output |
|---|---|
| `prove` | proof plus `tree_and_witness_ms`, `setup_ms`, `prove_ms`, `total_ms` |
| `verify` | `{verified, setup_ms, verify_ms}`; building the verifying key is charged to `setup_ms` |
| `check-k` | runs `keygen_vk` on a shape-only circuit; exits non-zero on `NotEnoughRowsAvailable` |
| `rho` | one field element, rejection-sampled on `OsRng` |

`MERKLE_DEPTH` and `HALO2_K` override `d` and `K` (defaults 9, 9). A `K` other than 9 writes its parameters
to `target/params_k<K>.bin`.

## `K` in the depth sweep

The smallest `K` that still has enough rows: the runner probes upward from `K = 4` with `check-k`, so every
smaller `K` has been tried and failed. Every attempt is recorded in
`experiments/results/quantitative/lap20_1509/theo_d/dD/k.json`.

## Runners

```bash
cd backend
npm run experiment:lap20:tonghop                   # rebuild the tables
THI_NGHIEM=theo_n npm run experiment:lap20         # ~2 h
THI_NGHIEM=theo_d npm run experiment:lap20         # ~1.5 h
npm run experiment:quantitative                    # single-run lot; KICH_BAN=1,10 restricts it
npm run experiment:artifacts
npm run experiment:qualitative -- ./experiment.config.json
```

Output: `experiments/results/quantitative/performance_offchain_n*.csv`, `proofs_offchain_n*.json`,
`gas_offchain_raw.csv`.

## End-to-end flow

Full walkthrough with expected output per step: [`FULL_FLOW_GUIDE.md`](FULL_FLOW_GUIDE.md) (Vietnamese).
From `backend/`, with Ganache + IPFS + MongoDB running. `accounts[0]` = university, `accounts[1]` = sponsor,
`accounts[2]` = student. `university:create` seeds the two staff accounts `CTSV-01` (student affairs) and
`KHTC-01` (finance); each `<…>` comes from the previous command's output.

```bash
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

npm run note:decrypt -- <cid> <notePrivateKey> | npm run withdrawal:create
npm run withdrawal:review -- <requestId> KHTC-01 approve
npm run withdrawal:review -- <requestId> KHTC-01 approve      # must fail
```

Expected output:

| Step | Result |
|---|---|
| `pool:deploy` | status `DEPLOYED`, `deploymentGasUsed 968565` |
| `pool:fund` | `balanceWei 1500000000000000000` (1 ETH initial + 0.5 ETH sponsor) |
| `scholarship:issue` | status `NOTE_CREATED`, IPFS CID, commitment computed by the prover |
| `root:approve` | root published, `gasUsed 73092` at `n = 1` |
| `withdrawal:create` | `OFF-CHAIN VERIFY PASSED`, status `PENDING_APPROVAL`, nullifier returned |
| `withdrawal:review` 1st | re-verifies, `withdraw gasUsed` 64 703 – 64 715, `usedNullifier` false → true, balance 1.5 → 1.4 ETH |
| `withdrawal:review` 2nd | rejected, `usedNullifier before: true` |

`deploymentGasUsed` and `root:approve` gas are exact. The per-withdrawal gas varies by a few tens of gas
around the benchmark mean (64 665 ± 5): the calldata byte pattern depends on `amount` and `recipient`.

## Output format

stdout is not pure JSON in this mode:

- MongoDB connection lines are printed to stdout before the payload — parse from the first `{`.
- `student:pubkey` prints `STUDENT PUBLIC KEY: 0x04…`.
- `scholarship:issue`, `root:approve` and `withdrawal:create` print a text report, not JSON. Useful patterns:
  `ENCRYPTED NOTE CID: (\S+)`, `COMMITMENT COMPUTED BY RUST: (\S+)`, `requestId: ([0-9a-f]{24})`,
  `nullifier\W+(0x[0-9a-f]{64})`.
- Ids are `universityId`, `poolId`, `requestId`.
