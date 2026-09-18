# Mode B — on-chain verification

Read [`../README.md`](../README.md) first: it holds the shared setup, the experiment method, the glossary of
Vietnamese file and column names, and the security notes. This file covers only what is specific to Mode B.

## What makes this mode different

The contract verifies the proof itself. `ShieldedPool` decodes the calldata and staticcalls a generated
`Halo2Verifier.sol`; the withdrawal is split in two transactions:

```solidity
verifyAndRecord(proof, root, nullifier, amount, recipient)   // onlySchool — decides who submits
settle(nullifier)                                            // pays out
```

`onlySchool` governs *who may submit*, not *whether the proof is checked* — the contract still verifies. Do
not describe this mode as "trusts no one"; describe it as "the contract verifies the proof, the university
submits it".

| | |
|---|---|
| Proof system | `halo2-axiom` 0.5.1 + `halo2-base` 0.5.0 + `snark-verifier-sdk` 0.2.3, KZG/SHPLONK over BN254 |
| `K` at `d = 9` | 13 |
| Proof / calldata | 4 224 B / 4 352 B |
| Verifier bytecode | 20 834 B — **84.8 % of the EIP-170 limit** |
| Prover process | one `bench-from-dataset` process per run: keygen once, then warm-up, then `n` proofs |

> ⚠️ **KZG parameters come from a fixed seed** (`ChaCha20Rng::from_seed([42u8; 32])`). That makes results
> reproducible but **is not a trusted setup** — anyone can recompute the trapdoor. Mode A needs no setup at
> all. This is the honest caveat to carry whenever the two modes are compared.

## Build and test

```bash
cargo build --release -p prover
cd contracts && npm ci && npm run compile && npm test && cd ..
cd backend   && npm ci && cp .env.example .env && npm run typecheck && npm test && cd ..
```

The contract tests include the binding checks added with the fourth public input: a withdrawal reverts when
the submitted `root`, `nullifier`, `amount` or `recipient` differs from the proof's public inputs — including
replaying a valid proof from a different wallet — and when the root was never approved. Two of them read
`experiments/results/quantitative/proofs_n1.json` and `proofs_n10.json`, which is why those files ship at the
root of `quantitative/` rather than only inside a run folder.

## The verifier contract

`contracts/contracts/Halo2Verifier.sol` is **generated**, and it is bound to the circuit shape — depth, the
number of public inputs, and `K`. Regenerate it only when one of those changes:

```bash
./target/release/prover export-verifier                  # writes contracts/contracts/Halo2Verifier.sol
./target/release/prover export-verifier-from-dataset <dataset.json>   # same, at that file's merkle_depth
cd contracts && npm run compile                          # then redeploy: the pool deploys its verifier
```

A verifier built for the wrong depth rejects every proof, so a depth sweep must regenerate it per depth. The
LAP20 runner does that automatically, then restores the `d = 9` verifier and checks its bytecode is
byte-identical to the one it started from.

That check compares the file on disk against **the version in git HEAD**, so the repository must be a git
checkout — `git init` is enough. If the check fails, the runner stops before measuring anything rather than
reporting numbers from a mismatched verifier.

## Choosing `K` in the depth sweep

**The smallest `K` whose verifier still fits EIP-170** (deployed bytecode ≤ 24 576 bytes) — not the smallest
`K` that builds.

A smaller `K` does not fail in halo2-base: it is answered with **more advice columns**, and every extra
column inflates the verifier. Measured at `d = 1`: `K = 10` has enough rows but produces a **31 110-byte**
verifier, over the limit, while `K = 11` fits in 20 806 bytes. Each depth's chosen `K`, its bytecode size and
every attempt are recorded in `experiments/results/quantitative/lap20_1509/theo_d/dD/verifier.json`.

Mode A uses the opposite rule (smallest `K` that has enough rows), because it has no verifier contract to
fit. The two rules are both measured, not assumed.

## Experiments

```bash
cd backend
npm run experiment:lap20:tonghop                    # Level 1: recompute the tables
THI_NGHIEM=theo_n npm run experiment:lap20          # Level 3: ~27 h
THI_NGHIEM=theo_d npm run experiment:lap20          # Level 3: ~24 h
npm run experiment:proofs                           # regenerates proofs AND rewrites Halo2Verifier.sol
npm run experiment:gas                              # ~5–7 min, Ganache only
npm run experiment:artifacts
npm run experiment:qualitative -- ./experiment.config.json
```

`experiment:proofs` rewrites the verifier, so recompile and redeploy before `experiment:gas`, or gas is
measured against a stale verifier. `generateAllProofs.ts` guards this with `EXPECTED_CALLDATA_BYTES`
(currently 4 352): a stale value silently skips every scenario instead of measuring the wrong thing.

Outputs land in `experiments/results/quantitative/` as `performance_onchain_n*.csv`, `proofs_n*.json` and
`gas_onchain_raw.csv`. Each LAP20 run also writes `luotNN/prover.log`, the stdout/stderr of that run's
prover process.

## End-to-end flow

The full walkthrough, with expected output at every step, is [`FULL_FLOW_TEST.md`](FULL_FLOW_TEST.md)
(Vietnamese). `npm run flow:full` runs the whole thing in one command; the step-by-step sequence, from
`backend/`, with Ganache + IPFS + MongoDB running:

```bash
npm run flow:reset                      # clears the six onchain_* collections in the configured database

# accounts[0] = university, accounts[1] = sponsor, accounts[2] = student
npm run university:create   -- "CLI University" <universityAddress>
npm run student:create      -- <universityId> CTSV-01 24560003 student@example.edu
npm run student:eligibility -- <universityId> CTSV-01 24560003 approve
npm run student:finance     -- <universityId> KHTC-01 24560003 100000000000000000

npm run pool:create  -- <universityId> KHTC-01
npm run pool:deploy  -- <poolId> KHTC-01 1000000000000000000     # deploys the verifier alongside the pool
npm run pool:fund    -- <poolId> KHTC-01 500000000000000000 <sponsorAddress>
npm run pool:balance -- <poolId>

npm run student:pubkey -- <notePrivateKey>
npm run student:wallet -- <universityId> CTSV-01 <poolId> student@example.edu <studentAddress> <publicKey>
npm run scholarship:issue -- <universityId> CTSV-01 24560003
npm run root:approve      -- <poolId> CTSV-01

npm run note:decrypt -- <cid> <notePrivateKey> | npm run withdrawal:create
npm run withdrawal:review -- <requestId> KHTC-01 approve
npm run withdrawal:review -- <requestId> KHTC-01 approve      # must FAIL: the EVM reverts
```

`university:create` seeds two staff accounts, `CTSV-01` (student affairs) and `KHTC-01` (finance); every
command is authorised against one of them. Each `<…>` is copied from the previous command's output.

What a successful run looks like, from our own 18 Sep 2026 walkthrough:

| Step | Evidence |
|---|---|
| `pool:deploy` | status `DEPLOYED`, both `contractAddress` and `verifierAddress` returned |
| `pool:fund` | balance `1500000000000000000` wei = 1 ETH initial + 0.5 ETH sponsor |
| `scholarship:issue` | status `NOTE_CREATED`, IPFS CID, commitment |
| `root:approve` | `Merkle nodes saved: 10` at `depth: 9`, root published |
| `withdrawal:create` | proof generated, request `PENDING_APPROVAL`, nullifier returned |
| `withdrawal:review` (1st) | status `EXECUTED`, `settleGas 69614`, `usedNullifier` true, pool 1.5 → 1.4 ETH |
| `withdrawal:review` (2nd) | `Transaction has been reverted by the EVM`, receipt `status: "0"` |

`settleGas` differs from the benchmark mean (69 626) by 12 gas because this walkthrough's `amount` and
`recipient` produce a slightly different calldata byte pattern; same mechanism, different bytes.

### Output conventions

Unlike Mode A, this mode does follow the convention: **one `JSON.stringify(…, null, 2)` object on stdout**,
human and debug text on stderr, non-zero exit on failure. So `… | ConvertFrom-Json` and `| jq` work directly,
and ids come back as `_id`.

The one command that reads stdin is `withdrawal:create`. On Windows PowerShell 5.1 the plain pipeline fails
with `Unexpected token '﻿'` because PowerShell prepends a BOM — see the workaround in the root README,
§5.
