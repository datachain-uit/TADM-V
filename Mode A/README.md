# Mode A — off-chain verification

Read [`../README.md`](../README.md) first: it holds the shared setup, the experiment method, the glossary of
Vietnamese file and column names, and the security notes. This file covers only what is specific to Mode A.

## What makes this mode different

The contract never sees a proof. The backend verifies the Halo2 proof natively and then calls

```solidity
withdrawOffChain(root, nullifier, recipient, amount)
```

which checks that the root was approved and that the nullifier is unused, marks it used, and pays. So the
contract enforces **single use** and **which root**, while *proof validity* is enforced by the backend. That
is the whole reason this mode costs about a tenth of Mode B per withdrawal — state it together with the
number, never alone.

| | |
|---|---|
| Proof system | `halo2_proofs` 0.3.2, IPA over the Pasta curves — **no trusted setup** |
| `K` at `d = 9` | 9 (parameters in `shared/params.bin`) |
| Proof size | 3 104 bytes |
| Contracts | `ShieldedPool.sol` only — there is no verifier contract to generate or redeploy |
| Prover process | one fresh process per proof and per verification |

Because the proof is never sent on-chain, changing the circuit does **not** require regenerating or
redeploying anything: the verifying key is rebuilt from the circuit on every `prove` / `verify`.

> ⚠️ `proof_bytes` stays 3 104 bytes across circuit changes, so this mode has **no self-check** that cached
> proofs belong to the current circuit. After changing the circuit, delete `proofs_offchain_n*.json` by hand.

## Build and test

```bash
cargo build --release -p prover
cd contracts && npm ci && npm run compile && npm test && cd ..
cd backend   && npm ci && cp .env.example .env && npm run typecheck && npm test && cd ..
cargo test --workspace --locked      # generates a real proof; slow
```

`cargo test` here includes the two negative tests that exist only in this mode: a tampered public input and
a forged note must both be rejected by `verify` even though proving still succeeds.

## Prover CLI

Mode-dispatched on argv, JSON over stdin/stdout:

```
setup | check-k | rho | commitment | nullifier | root | prove | verify
```

- `prove` emits `tree_and_witness_ms`, `setup_ms`, `prove_ms`, `total_ms` beside the proof.
- `verify` emits `{verified, setup_ms, verify_ms}`; building the verifying key is charged to `setup_ms`, so
  `verify_ms` is the verification itself.
- `check-k` runs `keygen_vk` on a shape-only circuit and exits non-zero on `NotEnoughRowsAvailable`. This is
  how `K` was chosen, and what the depth sweep uses.
- `rho` samples a field element by rejection sampling on `OsRng` — Node never generates `rho` itself.
- `MERKLE_DEPTH` and `HALO2_K` override `d` and `K` (defaults 9 and 9). A `K` other than 9 keeps its
  parameters in `target/params_k<K>.bin`, never in `shared/`.

## Choosing `K` in the depth sweep

**The smallest `K` that still has enough rows.** The runner probes upward from `K = 4` with `prover check-k`,
so every smaller `K` has been tried and has failed with `NotEnoughRowsAvailable`. The probe and all its
attempts are recorded in `experiments/results/quantitative/lap20_1509/theo_d/dD/k.json`.

This rule is **not** the one Mode B uses — see that mode's README for why.

## Experiments

```bash
cd backend
npm run experiment:lap20:tonghop                                   # Level 1: recompute the tables
THI_NGHIEM=theo_n npm run experiment:lap20                         # Level 3: ~2 h
THI_NGHIEM=theo_d npm run experiment:lap20                         # Level 3: ~1.5 h
npm run experiment:quantitative                                    # the single-run lot; KICH_BAN=1,10 restricts it
npm run experiment:artifacts
npm run experiment:qualitative -- ./experiment.config.json
```

Outputs land in `experiments/results/quantitative/` as `performance_offchain_n*.csv`,
`proofs_offchain_n*.json` and `gas_offchain_raw.csv`.

## End-to-end flow

The full walkthrough, with expected output at every step, is [`FULL_FLOW_GUIDE.md`](FULL_FLOW_GUIDE.md)
(Vietnamese). The command sequence, from `backend/`, with Ganache + IPFS + MongoDB running:

```bash
npm run flow:reset                      # clears the six flow collections in the configured database

# accounts[0] = university, accounts[1] = sponsor, accounts[2] = student
npm run university:create   -- "Demo University" <universityAddress>
npm run student:create      -- <universityId> CTSV-01 24560003 student@example.edu
npm run student:eligibility -- <universityId> CTSV-01 24560003 approve
npm run student:finance     -- <universityId> KHTC-01 24560003 100000000000000000

npm run pool:create  -- <universityId> KHTC-01
npm run pool:deploy  -- <poolId> KHTC-01 1000000000000000000
npm run pool:fund    -- <poolId> KHTC-01 500000000000000000 <sponsorAddress>
npm run pool:balance -- <poolId>

npm run student:pubkey -- <notePrivateKey>          # prints "STUDENT PUBLIC KEY: 0x04…"
npm run student:wallet -- <universityId> CTSV-01 <poolId> student@example.edu <studentAddress> <publicKey>
npm run scholarship:issue -- <universityId> CTSV-01 24560003
npm run root:approve      -- <poolId> CTSV-01

npm run note:decrypt -- <cid> <notePrivateKey> | npm run withdrawal:create
npm run withdrawal:review -- <requestId> KHTC-01 approve
npm run withdrawal:review -- <requestId> KHTC-01 approve      # must FAIL: nullifier already used
```

`university:create` seeds two staff accounts, `CTSV-01` (student affairs) and `KHTC-01` (finance); every
command is authorised against one of them. Each `<…>` is copied from the previous command's output.

What a successful run looks like, from our own 18 Sep 2026 walkthrough:

| Step | Evidence |
|---|---|
| `pool:deploy` | `deploymentGasUsed = 968565`, status `DEPLOYED` |
| `root:approve` | `gasUsed = 73092` at `n = 1`, root published |
| `scholarship:issue` | commitment computed by the Rust prover, note encrypted, IPFS CID returned, status `NOTE_CREATED` |
| `withdrawal:create` | `OFF-CHAIN VERIFY PASSED`, request `PENDING_APPROVAL`, nullifier returned |
| `withdrawal:review` (1st) | re-verifies, then `withdraw gasUsed 64715`, `usedNullifier` false → **true**, pool 1.5 → 1.4 ETH |
| `withdrawal:review` (2nd) | rejected — `usedNullifier before: true` |

The two deployment/root figures match the paper exactly. The per-withdrawal gas differs from the benchmark
mean (64 665 ± 5) by about 50 gas because this walkthrough's `amount` and `recipient` produce a slightly
different calldata byte pattern; same mechanism, different bytes.

### Output conventions — read this before scripting the flow

Mode A **does not** follow the "one JSON object on stdout" convention that Mode B follows:

- MongoDB connection lines (`MongoDB connected: …`) are printed to **stdout**, before the payload, so
  `| ConvertFrom-Json` or `| jq` fails. Parse from the first `{`.
- `student:pubkey` prints `STUDENT PUBLIC KEY: 0x04…`, not a bare key.
- `scholarship:issue`, `root:approve` and `withdrawal:create` answer with a **human-readable report**, not
  JSON. Extract values by regex (`ENCRYPTED NOTE CID: (\S+)`, `requestId: ([0-9a-f]{24})`, and so on).
- Ids are returned as `universityId` / `poolId` / `requestId` — not `_id` as in Mode B.

`FULL_FLOW_GUIDE.md` is written for a person pasting values between commands, which is why none of this
matters there. It matters as soon as a script is doing the pasting.
