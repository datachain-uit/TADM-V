# Groth16 baseline

The same relation as Mode B, proved with Groth16 instead of Halo2/KZG. It exists to support the one
comparison the paper draws in its Results section, and it changes exactly one variable: the proof system.
Same students, same Merkle depth `d = 9`, same gas accounting.

Shared conventions and the glossary of Vietnamese names: [`../README.md`](../README.md).

| | Groth16 baseline | Mode B, for reference |
|---|---|---|
| Proof system | Groth16 over BN128, Circom + SnarkJS | Halo2 KZG/SHPLONK over BN254 |
| Circuit | `circuits/withdraw.circom`, R1CS | Rust, PLONKish |
| Trusted setup | required, per circuit | universal parameters, no per-circuit ceremony |
| Verifier bytecode | **1 816 B** (7.4 % of EIP-170) | 20 834 B (84.8 %) |
| Pool bytecode | 9 207 B | 8 697 B |
| Proof size | 723 B | 4 224 B |
| Withdrawal calldata | 384 B | 4 352 B |
| Contract calls | `verifyAndRecord(proof, …)` then `settle(nullifier)` | same split |

## Requirements

Beyond the Node.js toolchain of the two modes, regenerating the circuit needs:

| | |
|---|---|
| `circom` | 2.x — a separate Rust binary, installed from circom's own releases |
| `snarkjs` | installed by `npm ci` below |

**`circom` is only needed to rebuild the circuit.** The artifact ships `build/withdraw.r1cs`, the witness
generator `build/withdraw_js/`, the proving key `build/withdraw_final.zkey` and
`build/verification_key.json`, so proving, verifying and measuring all work without it.

## Setup

```bash
npm ci
cd contracts && npm ci && npx hardhat compile && cd ..
```

The baseline runs its own chain on **port 8546**, so it does not collide with the 8545 instance the two
modes use:

```bash
npm run chain
```

### Rebuilding the circuit and the ceremony (optional)

```bash
npm run circuit:compile     # circom → build/withdraw.r1cs, build/withdraw_js/
npm run setup:ptau          # powers of tau, bn128, 2^14 — several minutes, writes ~31 MB to build/
npm run setup:zkey          # proving key → build/withdraw_final.zkey
npm run setup:verifier      # snarkjs → contracts/contracts/Groth16Verifier.sol
cd contracts && npx hardhat compile && cd ..
```

**Running this chain produces different keys.** snarkjs adds machine entropy to each contribution, so a new
ceremony yields a different `withdraw_final.zkey`, a different verification key and therefore a different
`Groth16Verifier.sol`. A proof made with one ceremony does not verify against
another ceremony's verifier, so keep the proving key and the verifier from the same run together.

What does not change is the size: a regenerated verifier still compiles to **1 816 bytes** of deployed
bytecode, the figure the paper reports.

To reproduce the published gas figures, use the `build/withdraw_final.zkey` and the
`contracts/contracts/Groth16Verifier.sol` that ship with this artifact, and skip this section.

The `.ptau` files are not shipped — they are 31 MB and `setup:ptau` regenerates them.

## Runners

```bash
npm run experiment:prepare      # builds experiments/data/inputs_n*.json from the shared students
npm run experiment:proofs       # proofs for every scenario → proofs_groth16_n*.json
npm run experiment:gas          # deploys, withdraws, records gas → gas_groth16_n*.csv
npm run experiment:artifacts    # contract sizes → artifact_sizes_groth16.json
```

Scenarios are `n ∈ {1, 10, 30, 60, 100, 500}`, the same set as the two modes. `experiment:gas` needs the
chain from `npm run chain`; the other three do not.

Output lands in `experiments/results/quantitative/`.

## Expected output

The committed lot was measured on 7 Sep 2026, on the machine in the root README §2, as **one run per
scenario** in which every student withdraws once. Each figure below is the mean over the `n` withdrawals of
that run.

**Gas** — the withdrawal is split in two transactions, so the comparable figure is their sum:

| `n` | `verify_record_gas` | `settle_gas` | sum |
|---|---|---|---|
| 1 | 321 843 | 69 626 | 391 469 |
| 10 | 321 818 | 69 622 | 391 440 |
| 30 | 321 825 | 69 624 | 391 449 |
| 60 | 321 823 | 69 624 | 391 447 |
| 100 | 321 801 | 69 624 | 391 425 |
| 500 | 321 801 | 69 624 | **391 425** |

Flat in `n`. The few tens of gas between scenarios are the calldata byte pattern: a zero byte costs 12 gas
less than a non-zero one.

**Deployment and sizes** — constant:

| | |
|---|---|
| `deploy_pool_gas` | 2 109 494 |
| `deploy_verifier_gas` | 445 503 |
| `update_root_gas` at `n = 500` | 458 856 |
| verifier deployed bytecode | 1 816 B |
| pool deployed bytecode | 9 207 B |

Proof generation and verification times are in `performance_groth16_n*.csv`. They come from the same single
run and are machine-dependent, so they are not tabulated here.

## Which files the paper quotes

These two files hold every Groth16 figure in the paper. **The runners overwrite them in place**, so a test
run must be redirected (next section).

| Figure in the paper | File | Where in it |
|---|---|---|
| 391 425 gas at `n = 500` | `experiments/results/quantitative/gas_groth16_n500.csv` | 500 data rows; per row `verify_record_gas` + `settle_gas`; the figure is the mean of that sum |
| 1 816 bytes | `experiments/results/quantitative/artifact_sizes_groth16.json` | `verifier_contract.deployed_bytecode_bytes` |

The rest of the lot — `gas_groth16_n{1,10,30,60,100}.csv`, `performance_groth16_n*.csv`,
`proofs_groth16_n*.json`, `gas_groth16_raw.csv` — is the same run at the other scenarios.

## Reproducing a single scenario

Set `THU_MUC_KQ` so the run writes somewhere else and the published lot stays untouched. Without it, the
runners overwrite the files above.

```bash
npm run chain                                                        # one terminal, port 8546
THU_MUC_KQ=experiments/results/quantitative/check npm run experiment:artifacts
THU_MUC_KQ=experiments/results/quantitative/check KICH_BAN=10 npm run experiment:gas
```

PowerShell: `$env:THU_MUC_KQ = "experiments/results/quantitative/check"`, and so on.

`experiment:gas` reads its proofs from `check/` when they are there and from the published lot otherwise, so
the command above works without regenerating proofs first.

Then compare:

| | Published lot | A `KICH_BAN=10` run |
|---|---|---|
| `verify_record_gas` + `settle_gas` | 391 440 | 391 440 |
| verifier deployed bytecode | 1 816 B | 1 816 B |

Gas is deterministic, so these must match exactly. Timing figures will not, and are not compared.
