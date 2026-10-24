require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

import fs from 'fs';
import path from 'path';

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
});

import { ethers } from 'ethers';
import { runProver } from '../clients/prover/halo2ProverClient';
import { normalizeCalldata, extractPublicInputs } from '../clients/blockchain/shieldedPoolClient';
import { writeCsv } from './sepoliaCsv';
import { RunLog, affordable, describe, feeOverrides, parseStudentList, sendTimed } from './sepoliaRun';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const N = 500;
const STUDENT_INDEXES = parseStudentList(process.env.SEPOLIA_STUDENTS, N);

const TX_TIMEOUT_MS = Number(process.env.SEPOLIA_TX_TIMEOUT_MS || 600_000);

const GANACHE_MNEMONIC = process.env.GANACHE_MNEMONIC || 'test test test test test test test test test test test junk';

const RPC_URL = process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545';

const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';

const VERIFIER_CALL_GAS = 3_000_000n;

const NETWORK_NAME: Record<string, string> = {
  '1337': 'ganache',
  '31337': 'hardhat',
  '11155111': 'sepolia',
};

const EXPLORER: Record<string, string> = {
  '11155111': 'https://sepolia.etherscan.io',
};

const MEASUREMENT_DIR = path.join(PROJECT_ROOT, 'experiments', 'results', 'quantitative', 'report_run');

const OUTPUT_DIR = path.join(PROJECT_ROOT, 'experiments', 'results', 'sepolia');

const PROOF_FILE = process.env.SEPOLIA_PROOFS
  ? path.resolve(PROJECT_ROOT, process.env.SEPOLIA_PROOFS)
  : path.join(MEASUREMENT_DIR, `proofs_n${N}.json`);

const SAME_LOT_PROOFS = !process.env.SEPOLIA_PROOFS;

const POOL_ARTIFACT = require(
  path.join(PROJECT_ROOT, 'contracts', 'artifacts', 'contracts', 'ShieldedPool.sol', 'ShieldedPool.json'),
);

const VERIFIER_ARTIFACT = require(
  path.join(PROJECT_ROOT, 'contracts', 'artifacts', 'contracts', 'Halo2Verifier.sol', 'Halo2Verifier.json'),
);

const SETUP_GAS_RESERVE = BigInt(Math.ceil((4_554_511 + 1_979_758 + 700_000) * 1.5));

const WITHDRAWAL_GAS_RESERVE = 1_400_000n;

function isLocalMachine(url: string): boolean {
  return /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
}

function timestamp(): string {
  const d = new Date();
  const pad2 = (x: number) => String(x).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
  );
}

function readCsv(file: string): any[] {
  const row = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l: string) => l.trim() !== '');

  const header = String(row[0]).split(',');

  return row.slice(1).map((l: string) => {
    const cells: any = {};
    l.split(',').forEach((v: string, i: number) => {
      cells[String(header[i])] = v;
    });
    return cells;
  });
}

function parseCalldata(data: string) {
  const hex = data.startsWith('0x') ? data.slice(2) : data;

  let zero = 0;
  let nonZero = 0;

  for (let i = 0; i < hex.length; i += 2) {
    if (hex.slice(i, i + 2) === '00') {
      zero += 1;
    } else {
      nonZero += 1;
    }
  }

  const token = zero + 4 * nonZero;

  return {
    calldata_bytes: zero + nonZero,
    zero_bytes: zero,
    nonzero_bytes: nonZero,
    tokens: token,
    standard_calldata_gas: 4 * zero + 16 * nonZero,
    eip7623_floor_gas: 21_000 + 10 * token,
  };
}

function reasonOf(err: any): string {
  return String(err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || err);
}

function explorerLink(chainId: string, hash: string): string | null {
  const root = EXPLORER[chainId];
  return root ? `${root}/tx/${hash}` : null;
}

async function addressState(provider: any, account: string) {
  const [balance, nonce, errorCode] = await Promise.all([
    provider.getBalance(account),
    provider.getTransactionCount(account),
    provider.getCode(account),
  ]);

  return {
    balance_wei: balance.toString(),
    nonce: Number(nonce),
    has_code: errorCode !== '0x',
    existed: balance > 0n || Number(nonce) > 0 || errorCode !== '0x',
  };
}

async function waitForReceipt(tx: any) {
  const receipt = await tx.wait();

  return {
    hash: String(tx.hash),
    block: Number(receipt.blockNumber),
    gas_used: Number(receipt.gasUsed),
    status: Number(receipt.status),
  };
}

async function sendExpectRevert(fn: any, args: any[], gasLimit: bigint, provider: any) {
  let staticRevert = false;
  let revertReason = '';

  try {
    await fn.staticCall(...args);
  } catch (e: any) {
    staticRevert = true;
    revertReason = reasonOf(e);
  }

  let hash: string | null = null;
  let receipt: any = null;
  let sendError = '';

  try {
    const tx = await fn(...args, { gasLimit });
    hash = String(tx.hash);

    try {
      receipt = await tx.wait();
    } catch (e: any) {
      receipt = e?.receipt || (await provider.getTransactionReceipt(hash));
    }
  } catch (e: any) {
    sendError = reasonOf(e);
  }

  return {
    static_call_reverted: staticRevert,
    revert_reason: revertReason,
    send_error: sendError || null,
    hash,
    block: receipt ? Number(receipt.blockNumber) : null,
    status: receipt ? Number(receipt.status) : null,
    gas_used: receipt ? Number(receipt.gasUsed) : null,
  };
}

async function main() {
  const dataset = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'experiments', 'data', `dataset_n${N}.json`), 'utf8'),
  );

  const proofs: any[] = JSON.parse(fs.readFileSync(PROOF_FILE, 'utf8'));

  const baseline: any[] = readCsv(path.join(MEASUREMENT_DIR, `gas_onchain_n${N}.csv`));

  const studentData: any[] = dataset.students;

  console.error(`Computing ${studentData.length} commitments from the dataset ...`);

  const commitments: string[] = studentData.map((student: any) =>
    String(runProver('commitment', student.note).commitment),
  );

  console.error('Computing the root from 500 commitments (takes about 30 seconds) ...');

  const computedRoot = String(runProver('root', { commitments }).root).toLowerCase();
  const rootProof = String(proofs[0]?.root).toLowerCase();

  if (computedRoot !== rootProof) {
    throw new Error(
      `recomputed root ${computedRoot} differs from the proof root ${rootProof} — stopping before spending ETH`,
    );
  }

  for (const i of STUDENT_INDEXES) {
    const p = proofs.find((x: any) => x.student_index === i);

    if (!p) {
      throw new Error(`no proof for student_index ${i}`);
    }

    if (String(p.root).toLowerCase() !== rootProof) {
      throw new Error(`proof ${i} does not share the pool root`);
    }

    const publicInputs = extractPublicInputs(normalizeCalldata(p));
    if (BigInt(publicInputs.recipient) !== BigInt(p.address)) {
      throw new Error(
        `proof ${i} does not carry recipient wallet ${p.address} — it is a pre-A25 proof;` +
          ' rerun the quantitative experiment (experiment:proofs + experiment:gas) before validating',
      );
    }
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const chainId = String((await provider.getNetwork()).chainId);
  const networkName = NETWORK_NAME[chainId];

  if (!networkName) {
    throw new Error(`chainId ${chainId} is not in the allow-list (ganache / hardhat / sepolia)`);
  }

  const local = isLocalMachine(RPC_URL);
  const defaultWallet = ethers.Wallet.fromPhrase(GANACHE_MNEMONIC);

  let wallet: any;

  if (PRIVATE_KEY) {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  } else if (local) {
    wallet = defaultWallet.connect(provider);
  } else {
    throw new Error('A public network needs SEPOLIA_PRIVATE_KEY in backend/.env');
  }

  if (!local && wallet.address.toLowerCase() === defaultWallet.address.toLowerCase()) {
    throw new Error("the public 'test ... junk' mnemonic wallet must not be used on a real network");
  }

  const totalAmount: bigint = studentData.reduce((s: bigint, student: any) => s + BigInt(student.note.amount), 0n);

  const poolFunding = totalAmount + totalAmount / BigInt(N);

  const resumeDir = process.env.SEPOLIA_RUN;
  const runLog = resumeDir ? RunLog.open(resumeDir) : RunLog.create(OUTPUT_DIR, networkName);
  let state = runLog.readState();

  const balanceAtStart: bigint = await provider.getBalance(wallet.address);
  const fullNeed = await affordable(
    provider,
    wallet.address,
    (resumeDir ? 0n : SETUP_GAS_RESERVE) + WITHDRAWAL_GAS_RESERVE * BigInt(STUDENT_INDEXES.length),
  );

  console.error(
    `Network ${networkName} (chainId ${chainId}) | wallet ${wallet.address}` +
      ` | balance ${ethers.formatEther(balanceAtStart)} ETH | ${STUDENT_INDEXES.length} withdrawals planned` +
      ` | estimated need for all ${ethers.formatEther(fullNeed.needed + poolFunding)} ETH` +
      ` at ${ethers.formatUnits(fullNeed.price, 'gwei')} gwei | run folder ${runLog.dir}`,
  );

  let pool: any;
  let verifierAddress: string;
  let verifierDeploy: any;
  let deployExperimentPool: any;
  let rootApproval: any;
  let calldataRoot: any;

  if (resumeDir) {
    if (state.chain_id !== chainId || String(state.school_address).toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(`SEPOLIA_RUN belongs to chain ${state.chain_id} / school ${state.school_address}`);
    }

    verifierAddress = state.halo2_verifier;
    pool = new ethers.Contract(state.shielded_pool, POOL_ARTIFACT.abi, wallet);
    verifierDeploy = state.deploy_verifier;
    deployExperimentPool = state.deploy_pool;
    rootApproval = state.update_root;
    calldataRoot = state.update_root_calldata;

    console.error(
      `Resuming pool ${state.shielded_pool} (${runLog.readWithdrawals().length} withdrawals already logged)`,
    );
  } else {
    const setup = await affordable(provider, wallet.address, SETUP_GAS_RESERVE + WITHDRAWAL_GAS_RESERVE);

    if (balanceAtStart < setup.needed + poolFunding) {
      throw new Error(
        `insufficient balance: about ${ethers.formatEther(setup.needed + poolFunding)} ETH needed to deploy,` +
          ' approve the root and make one withdrawal',
      );
    }

    state = runLog.writeState({
      network: networkName,
      chain_id: chainId,
      school_address: wallet.address,
      started_at: new Date().toISOString(),
    });

    console.error('Deploy Halo2Verifier ...');

    const factoryVerifier = new ethers.ContractFactory(VERIFIER_ARTIFACT.abi, VERIFIER_ARTIFACT.bytecode, wallet);

    const verifier: any = await factoryVerifier.deploy(await feeOverrides(provider));
    verifierDeploy = await waitForReceipt(verifier.deploymentTransaction());
    verifierAddress = String(await verifier.getAddress());

    state = runLog.writeState({ halo2_verifier: verifierAddress, deploy_verifier: verifierDeploy });

    console.error('Deploy ShieldedPool ...');

    const factoryPool = new ethers.ContractFactory(POOL_ARTIFACT.abi, POOL_ARTIFACT.bytecode, wallet);

    pool = await factoryPool.deploy(verifierAddress, '0', { value: poolFunding, ...(await feeOverrides(provider)) });
    deployExperimentPool = await waitForReceipt(pool.deploymentTransaction());

    state = runLog.writeState({ shielded_pool: String(await pool.getAddress()), deploy_pool: deployExperimentPool });

    console.error(`Approving the root with ${commitments.length} commitments ...`);

    const txRoot = await pool.updateRoot(rootProof, commitments, await feeOverrides(provider));
    rootApproval = await waitForReceipt(txRoot);
    calldataRoot = parseCalldata(String(txRoot.data));

    state = runLog.writeState({ update_root: rootApproval, update_root_calldata: calldataRoot });
  }

  const poolAddress = String(await pool.getAddress());
  const currentRoot = String(await pool.currentRoot()).toLowerCase();
  const rootValid = Boolean(await pool.validRoot(rootProof));

  if (currentRoot !== rootProof || !rootValid) {
    throw new Error(`pool ${poolAddress} does not hold the dataset root — stopping`);
  }

  const alreadyLogged = new Set(runLog.readWithdrawals().map((w: any) => w.student_index));
  let stoppedReason: string | null = null;
  let skippedAlreadyUsed = 0;

  for (const i of STUDENT_INDEXES) {
    if (alreadyLogged.has(i)) {
      continue;
    }

    const p = proofs.find((x: any) => x.student_index === i);

    const proofAndSignals = normalizeCalldata(p);

    const { root, nullifier, amountWei } = extractPublicInputs(proofAndSignals);

    if (await pool.usedNullifier(nullifier)) {
      skippedAlreadyUsed++;
      console.error(`student ${i}: nullifier already used on chain but not in the log — skipped`);
      continue;
    }

    const budget = await affordable(provider, wallet.address, WITHDRAWAL_GAS_RESERVE);

    if (!budget.ok) {
      stoppedReason =
        `balance ${ethers.formatEther(budget.balance)} ETH is below one withdrawal` +
        ` (${ethers.formatEther(budget.needed)} ETH) before student ${i}`;
      console.error(`STOPPING: ${stoppedReason}`);
      break;
    }

    const recipientAddress = await addressState(provider, p.address);

    const t0 = performance.now();

    await provider.call({
      to: verifierAddress,
      data: proofAndSignals,
      gasLimit: VERIFIER_CALL_GAS,
    });

    const verifyMs = performance.now() - t0;

    const claim = await pool.claims(nullifier);
    let recordReceipt: any = null;

    if (claim.verified) {
      console.error(`student ${i}: claim already recorded on chain — settling only`);
    } else {
      recordReceipt = await sendTimed(
        provider,
        (overrides: any) => pool.verifyAndRecord(proofAndSignals, root, nullifier, p.address, amountWei, overrides),
        TX_TIMEOUT_MS,
      );
    }

    const settleReceipt = await sendTimed(
      provider,
      (overrides: any) => pool.settle(nullifier, overrides),
      TX_TIMEOUT_MS,
    );

    const baselineRow = baseline.find((r: any) => Number(r.student_index) === i);
    const baselineRecordGas = baselineRow ? Number(baselineRow.verify_record_gas) : null;
    const baselineSettleGas = baselineRow ? Number(baselineRow.settle_gas) : null;
    const baselineVerifyMs = baselineRow ? Number(baselineRow.verify_onchain_ms) : null;

    const entry = {
      student_index: i,
      recipient: p.address,
      recipient_existed_before: recipientAddress.existed,
      verify_by_call_ms: Number(verifyMs.toFixed(2)),
      ganache_verify_onchain_ms: baselineVerifyMs,
      verify_and_record: recordReceipt
        ? {
            ...recordReceipt,
            explorer: explorerLink(chainId, recordReceipt.hash),
            ganache_gas_used: baselineRecordGas,
            delta_vs_ganache: baselineRecordGas === null ? null : recordReceipt.gas_used - baselineRecordGas,
          }
        : { recorded_in_an_earlier_session: true, gas_used: null, status: 1 },
      settle: {
        ...settleReceipt,
        explorer: explorerLink(chainId, settleReceipt.hash),
        ganache_gas_used: baselineSettleGas,
        delta_vs_ganache: baselineSettleGas === null ? null : settleReceipt.gas_used - baselineSettleGas,
      },
      split_total_gas: recordReceipt ? recordReceipt.gas_used + settleReceipt.gas_used : null,
      withdrawal_confirm_ms: (recordReceipt ? recordReceipt.confirm_ms : 0) + settleReceipt.confirm_ms,
      nullifier_marked_used: Boolean(await pool.usedNullifier(nullifier)),
    };

    runLog.appendWithdrawal(entry, [
      ...(recordReceipt
        ? [
            {
              student_index: i,
              step: 'verifyAndRecord',
              tx_hash: recordReceipt.hash,
              ...recordReceipt,
              note: `recipient ${p.address}; verifier eth_call ${entry.verify_by_call_ms} ms`,
            },
          ]
        : []),
      { student_index: i, step: 'settle', tx_hash: settleReceipt.hash, ...settleReceipt, note: '' },
    ]);

    console.error(
      `student ${i}: verifyAndRecord gas ${recordReceipt ? recordReceipt.gas_used : '—'}, settle gas ${settleReceipt.gas_used},` +
        ` ${entry.withdrawal_confirm_ms.toFixed(1)} ms`,
    );
  }

  const withdrawalRun = runLog.readWithdrawals();

  if (withdrawalRun.length === 0) {
    throw new Error(`no withdrawal was made${stoppedReason ? ` — ${stoppedReason}` : ''}`);
  }

  const replayIndex = withdrawalRun[0].student_index;

  console.error(`Replaying the nullifier of student ${replayIndex} ...`);

  const p0 = proofs.find((x: any) => x.student_index === replayIndex);
  const calldata0 = normalizeCalldata(p0);
  const publicInputs0 = extractPublicInputs(calldata0);

  const recordReplay = await sendExpectRevert(
    pool.verifyAndRecord,
    [calldata0, publicInputs0.root, publicInputs0.nullifier, p0.address, publicInputs0.amountWei],
    300_000n,
    provider,
  );

  const settleReplay = await sendExpectRevert(pool.settle, [publicInputs0.nullifier], 200_000n, provider);

  console.error('Rebuilding the tree from the CommitmentsPublished log (takes about 30 seconds) ...');

  const chainEvent = pool.interface.getEvent('CommitmentsPublished');

  const logs = await provider.getLogs({
    address: poolAddress,
    topics: [chainEvent.topicHash],
    fromBlock: rootApproval.block,
    toBlock: rootApproval.block,
  });

  if (logs.length === 0) {
    throw new Error('no CommitmentsPublished log found on chain');
  }

  const decoded = pool.interface.parseLog(logs[0]);
  const onChainIndex: string[] = Array.from(decoded.args.commitments).map((x: any) => String(x));
  const rebuiltRoot = String(runProver('root', { commitments: onChainIndex }).root).toLowerCase();

  const baselineVerifierDeployGas = Number(baseline[0]?.deploy_verifier_gas);
  const baselinePoolDeployGas = Number(baseline[0]?.deploy_pool_gas);
  const baselineRootGas = Number(baseline[0]?.update_root_gas);

  const isRejected = (k: any) => k.static_call_reverted && (k.status === 0 || k.send_error !== null);

  const criteria = {
    deployed: verifierDeploy.status === 1 && deployExperimentPool.status === 1,
    root_approved: rootApproval.status === 1 && currentRoot === rootProof && rootValid,
    all_withdrawals_succeeded: withdrawalRun.every(
      (r: any) => r.verify_and_record.status === 1 && r.settle.status === 1 && r.nullifier_marked_used,
    ),
    replay_rejected: isRejected(recordReplay) && isRejected(settleReplay),
    root_rebuilt_from_chain_logs: rebuiltRoot === currentRoot && onChainIndex.length === N,
  };

  const allPassed = Object.values(criteria).every(Boolean);

  const finishedAt = new Date().toISOString();
  const lastConfirmation = withdrawalRun
    .map((r: any) => Date.parse(r.settle.sent_at) + r.settle.confirm_ms)
    .reduce((a: number, b: number) => Math.max(a, b), 0);
  const recorded = withdrawalRun.filter((r: any) => r.verify_and_record.gas_used !== null);

  const round = {
    planned: STUDENT_INDEXES.length,
    withdrawn: withdrawalRun.length,
    complete: withdrawalRun.length === STUDENT_INDEXES.length,
    stopped_reason: stoppedReason,
    skipped_already_used_not_logged: skippedAlreadyUsed,
    started_at: state.started_at,
    last_confirmation_at: new Date(lastConfirmation).toISOString(),
    round_wall_ms: lastConfirmation - Date.parse(state.started_at),
    verify_record_gas: describe(recorded.map((r: any) => r.verify_and_record.gas_used)),
    settle_gas: describe(withdrawalRun.map((r: any) => r.settle.gas_used)),
    split_total_gas: describe(recorded.map((r: any) => r.split_total_gas)),
    blocks_waited_verify_record: describe(recorded.map((r: any) => r.verify_and_record.blocks_waited)),
    blocks_waited_settle: describe(withdrawalRun.map((r: any) => r.settle.blocks_waited)),
    withdrawal_confirm_ms: describe(withdrawalRun.map((r: any) => r.withdrawal_confirm_ms)),
    verify_by_call_ms: describe(withdrawalRun.map((r: any) => r.verify_by_call_ms)),
    recipients_existed_before: withdrawalRun.filter((r: any) => r.recipient_existed_before).length,
    total_gas:
      verifierDeploy.gas_used +
      deployExperimentPool.gas_used +
      rootApproval.gas_used +
      withdrawalRun.reduce((s: number, r: any) => s + (r.verify_and_record.gas_used ?? 0) + r.settle.gas_used, 0),
    note:
      'withdrawals are sent one after another, each waiting for its receipt — round_wall_ms is the total time of' +
      ' this sequential round, not a throughput measurement',
  };

  const evidence = {
    metadata: {
      mechanism: 'onchain',
      measured_at_local: timestamp(),
      finished_at: finishedAt,
      network: networkName,
      chain_id: chainId,
      rpc_host: new URL(RPC_URL).host,
      school_address: wallet.address,
      n_pool: N,
      students_withdrawn: withdrawalRun.map((r: any) => r.student_index),
      run_folder: path.relative(PROJECT_ROOT, runLog.dir).replace(/\\/g, '/'),
      withdrawal_design: 'split — verifyAndRecord + settle',
      reference_run: 'experiments/results/quantitative/report_run (09/09/2026, Ganache, Shanghai)',
      proof_source: path.relative(PROJECT_ROOT, PROOF_FILE).replace(/\\/g, '/'),
      baseline_same_circuit: SAME_LOT_PROOFS,
      baseline_note: SAME_LOT_PROOFS
        ? 'proofs and gas CSV come from the same measurement lot — every delta_vs_ganache is a real comparison'
        : 'proofs come from SEPOLIA_PROOFS, not from report_run: same circuit, root and nullifiers, recipients' +
          ' replaced by fresh wallets (the published recipients carry third-party EIP-7702 code on Sepolia that' +
          ' rejects ETH). verify_record gas depends on the calldata bytes, so it differs from report_run by a few' +
          ' tens of gas; a fresh recipient adds the cost of creating its account in settle.',
    },
    level2_criteria: criteria,
    level2_reached: allPassed && networkName === 'sepolia',
    round,
    contracts: {
      halo2_verifier: verifierAddress,
      shielded_pool: poolAddress,
      explorer_verifier: EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${verifierAddress}` : null,
      explorer_pool: EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${poolAddress}` : null,
    },
    deploy_verifier: {
      ...verifierDeploy,
      explorer: explorerLink(chainId, verifierDeploy.hash),
      ganache_gas_used: baselineVerifierDeployGas,
      delta_vs_ganache: verifierDeploy.gas_used - baselineVerifierDeployGas,
    },
    deploy_pool: {
      ...deployExperimentPool,
      explorer: explorerLink(chainId, deployExperimentPool.hash),
      ganache_gas_used: baselinePoolDeployGas,
      delta_vs_ganache: deployExperimentPool.gas_used - baselinePoolDeployGas,
    },
    update_root: {
      ...rootApproval,
      explorer: explorerLink(chainId, rootApproval.hash),
      commitments: commitments.length,
      ganache_gas_used: baselineRootGas,
      delta_vs_ganache: rootApproval.gas_used - baselineRootGas,
      calldata: calldataRoot,
      gas_equals_eip7623_floor: rootApproval.gas_used === calldataRoot.eip7623_floor_gas,
      current_root_on_chain: currentRoot,
      valid_root_on_chain: rootValid,
    },
    withdrawals: withdrawalRun,
    nullifier_replay: {
      student_index: replayIndex,
      verify_and_record_again: {
        ...recordReplay,
        explorer: recordReplay.hash ? explorerLink(chainId, recordReplay.hash) : null,
      },
      settle_again: {
        ...settleReplay,
        explorer: settleReplay.hash ? explorerLink(chainId, settleReplay.hash) : null,
      },
    },
    root_rebuild_from_logs: {
      log_block: rootApproval.block,
      commitments_in_log: onChainIndex.length,
      rebuilt_root: rebuiltRoot,
      matches_current_root: rebuiltRoot === currentRoot,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const file = path.join(OUTPUT_DIR, `validation_${networkName}.json`);

  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  const csvFile = writeCsv(evidence, file.replace(/\.json$/, '.csv'));

  const summaryRow = (name: string, current: number, previous: number) =>
    `  ${name.padEnd(24)} ${String(current).padStart(10)}   Ganache ${String(previous).padStart(10)}   diff ${current - previous >= 0 ? '+' : ''}${current - previous}`;

  console.log(`\n=== ON-CHAIN VALIDATION on ${networkName} (chainId ${chainId}) ===`);
  console.log(`  verifier: ${verifierAddress}`);
  console.log(`  pool    : ${poolAddress}`);
  console.log(summaryRow('deploy_verifier', verifierDeploy.gas_used, baselineVerifierDeployGas));
  console.log(summaryRow('deploy_pool', deployExperimentPool.gas_used, baselinePoolDeployGas));
  console.log(
    summaryRow('update_root (500)', rootApproval.gas_used, baselineRootGas) +
      `   EIP-7623 floor ${calldataRoot.eip7623_floor_gas}`,
  );

  if (withdrawalRun.length <= 10) {
    for (const r of withdrawalRun) {
      if (r.verify_and_record.gas_used !== null) {
        console.log(
          summaryRow(
            `verify_record student ${r.student_index}`,
            r.verify_and_record.gas_used,
            r.verify_and_record.ganache_gas_used,
          ),
        );
      }
      console.log(
        summaryRow(`settle student ${r.student_index}`, r.settle.gas_used, r.settle.ganache_gas_used) +
          (r.recipient_existed_before ? '' : '   (fresh recipient address)'),
      );
    }
  }

  console.log(
    `  withdrawals              ${round.withdrawn} / ${round.planned}${round.stopped_reason ? `   STOPPED: ${round.stopped_reason}` : ''}`,
  );
  console.log(
    `  verify_record gas        min ${round.verify_record_gas.min} · mean ${round.verify_record_gas.mean} · max ${round.verify_record_gas.max}`,
  );
  console.log(
    `  settle gas               min ${round.settle_gas.min} · mean ${round.settle_gas.mean} · max ${round.settle_gas.max}`,
  );
  console.log(
    `  confirmation ms          min ${round.withdrawal_confirm_ms.min} · median ${round.withdrawal_confirm_ms.median} · max ${round.withdrawal_confirm_ms.max}   (verifyAndRecord + settle)`,
  );
  console.log(`  round wall time          ${(round.round_wall_ms / 60000).toFixed(1)} min (sequential)`);
  console.log(
    `  nullifier replay         ${criteria.replay_rejected ? 'REJECTED ✅' : 'NOT rejected 🔴'}` +
      `   (${recordReplay.revert_reason || recordReplay.send_error} | ${settleReplay.revert_reason || settleReplay.send_error})`,
  );
  console.log(`  tree rebuilt from logs   ${criteria.root_rebuilt_from_chain_logs ? 'MATCHES ✅' : 'MISMATCH 🔴'}`);
  console.log(
    `  level-2 criteria         ${allPassed ? 'ALL 5 PASSED ✅' : 'NOT PASSED 🔴'}${networkName === 'sepolia' ? '' : '   (trial run — not a public network)'}`,
  );
  console.log(`\nWritten: ${file}`);
  console.log(`Written: ${csvFile}`);
  console.log(`Run folder: ${runLog.dir}${round.complete ? '' : '   (resume with SEPOLIA_RUN=<this folder>)'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((error: any) => {
  console.error(error);
  process.exit(1);
});
