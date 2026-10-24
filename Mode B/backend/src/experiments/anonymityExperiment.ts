import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

require('dotenv').config({ quiet: true });

import { createUniversity } from '../services/university.service';
import { seedDefaultStaff } from '../services/staff.service';
import { createStudentProfile } from '../services/student.service';
import { approveEligibility } from '../services/student.service';
import { approveFinance } from '../services/student.service';
import { createScholarshipPool } from '../services/pool.service';
import { deployScholarshipPool } from '../services/pool.service';
import { registerStudentWallet } from '../services/studentWallet.service';
import { issueScholarship } from '../services/scholarship.service';
import { approveRoot } from '../services/rootApproval.service';
import { createWithdrawalRequest } from '../services/withdrawalRequest.service';
import { reviewWithdrawalRequest } from '../services/withdrawalReview.service';
import { derivePublicKeyFromPrivateKey } from '../clients/ipfs/noteEncryption';
import { getStudentFromIpfs } from '../clients/ipfs/encryptedNoteStorage';
import { getPool, getWeb3 } from '../clients/blockchain/blockchainClient';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { resetDatabase } from '../scripts/resetDatabase';

const EXPERIMENT_DATABASE_PATTERN = /anonymity|qualitative|experiment/i;

type Scenario = {
  n: number;
  withdrawerCount: number;
  sameAmount: boolean;

  shuffleWithdrawOrder?: boolean;

  shuffleSeed?: number;

  amountTiers?: AmountTier[];

  walletReuseProbe?: number;
};

type AmountTier = {
  amountWei: string;
  share: number;
};

type AnonymityConfig = {
  university: {
    name: string;
    walletAddress: string;
  };
  student: {
    startingStudentId: number;
    amountWei: string;
    amountStep: string;
  };
  scenario: Scenario[];
};

function jsonSafe(value: any) {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function currentGitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function measurementConditions() {
  const os = require('os');
  const cpus = os.cpus() || [];

  return {
    cpu: cpus[0]?.model || 'unknown',
    cpuCores: cpus.length,
    ramGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    os: os.type() + ' ' + os.release(),
    nodeVersion: process.version,
    k: 13,
    curve: 'BN254 (Fr)',
    provingSystem: 'KZG-SHPLONK (snark-verifier-sdk)',
    merkleDepth: 9,
    maxLeaves: 512,
  };
}

function keyFromIndex(prefix: string, i: number): string {
  return '0x' + (BigInt(prefix) + BigInt(i + 1)).toString(16).padStart(64, '0');
}

function scenarioLabel(scenario: Scenario): string {
  if (scenario.sameAmount) {
    return '_same-amount';
  }

  return scenario.amountTiers?.length ? '_tiers' + scenario.amountTiers.length : '_different-amount';
}

function tierAmounts(scenario: Scenario): string[] | null {
  const tiers = scenario.amountTiers;

  if (!tiers?.length) {
    return null;
  }

  const totalShare = tiers.reduce((t, tier) => t + tier.share, 0);
  const counts = tiers.map((tier) => Math.floor((tier.share / totalShare) * scenario.n));

  for (let i = 0; counts.reduce((t, c) => t + c, 0) < scenario.n; i = (i + 1) % tiers.length) {
    counts[i]! += 1;
  }

  const labels = tiers.flatMap((tier, i) => Array.from({ length: counts[i]! }, () => tier.amountWei));

  return shuffle(labels, (scenario.shuffleSeed ?? 12345) + 7 * scenario.n);
}

function tierStatistics(scenario: Scenario, list: any[], audit: any[]) {
  if (!scenario.amountTiers?.length) {
    return null;
  }

  return scenario.amountTiers.map((tier) => {
    const students = list.filter((student) => student.amountWei === tier.amountWei).length;
    const withdrawals = audit.filter((x: any) => x.observedAmount === tier.amountWei);

    return {
      amountWei: tier.amountWei,
      share: tier.share,
      students,
      withdrawals: withdrawals.length,
      anonymitySetByAmount: withdrawals.length ? withdrawals[0].anonymitySetByAmount : students,
    };
  });
}

function buildStudentList(config: AnonymityConfig, scenario: Scenario) {
  const web3 = getWeb3();
  const list = [];
  const tiers = tierAmounts(scenario);

  for (let i = 0; i < scenario.n; i += 1) {
    const noteKey = keyFromIndex('0x1c0de00000000000000000000000000000000000000000000000000000000000', i);
    const walletKey = keyFromIndex('0x2a11e70000000000000000000000000000000000000000000000000000000000', i);
    const wallet = web3.eth.accounts.privateKeyToAccount(walletKey).address;
    const amountWei = scenario.sameAmount
      ? config.student.amountWei
      : tiers
        ? tiers[i]!
        : (BigInt(config.student.amountWei) + BigInt(config.student.amountStep) * BigInt(i)).toString();

    list.push({
      id: config.student.startingStudentId + i,
      email: 'student' + (config.student.startingStudentId + i) + '@anonymity.test',
      walletAddress: wallet,
      privateKey: noteKey,
      publicKey: derivePublicKeyFromPrivateKey(noteKey),
      amountWei,
      cid: null as string | null,
      commitment: null as string | null,
      merkleIndex: null as number | null,
      hasWithdrawn: false,
    });
  }

  return list;
}

function loadScenarioFromCsv(filePath: string, scenario: Scenario) {
  const row = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((x: string) => x.length > 0);
  const columns = row[0]!.split(',');
  const iSet = columns.indexOf('anonymity_set_by_amount');
  const iCorrect = columns.indexOf('correct_guess_by_amount');
  const details = row.slice(1).map((d: string) => {
    const cells = d.split(',');

    return {
      anonymitySetByAmount: Number(cells[iSet]),
      correctGuessByAmount: cells[iCorrect] === 'true',
    };
  });
  const correctCount = details.filter((x: any) => x.correctGuessByAmount).length;

  return {
    scenario: scenario,
    loadedFromFile: true,
    amountTiers: null,
    walletReuse: null,
    withdrawalCount: details.length,
    correctGuessesByAmount: correctCount,
    totalWithdrawals: details.length,
    accuracyByAmount: details.length ? correctCount / details.length : 0,
    meanAnonymitySetByAmount: details.length
      ? details.reduce((t: number, x: any) => t + x.anonymitySetByAmount, 0) / details.length
      : 0,
    details,
  };
}

async function resetGuarded() {
  const connection = await connectDatabase();
  const name = String(connection.name || '');

  if (!EXPERIMENT_DATABASE_PATTERN.test(name)) {
    await disconnectDatabase();

    throw new Error(
      'RESET REFUSED: database "' +
        name +
        '" is not an experiment' +
        ' database. Point MONGODB_URI at a separate database.',
    );
  }

  const results = await resetDatabase();

  await disconnectDatabase();

  return results;
}

function prngFromSeed(seed: number) {
  let t = seed >>> 0;

  return function () {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);

    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const result = items.slice();
  const rand = prngFromSeed(seed);

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const temp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = temp;
  }

  return result;
}

function observer(list: any[], events: any[]) {
  const hasDuplicateWallets = new Set(list.map((student) => student.walletAddress.toLowerCase())).size !== list.length;

  const submissionOrder = list.filter((student: any) => student.hasWithdrawn);

  const withdrawerIds = events
    .map((ev: any) => {
      const recipient = String(ev.returnValues.recipient).toLowerCase();
      const withdrawer = list.find((student) => student.walletAddress.toLowerCase() === recipient);

      return withdrawer ? withdrawer.id : null;
    })
    .filter((id: any) => id !== null);

  return events.map((ev: any, position: number) => {
    const amount = String(ev.returnValues.amount);
    const recipient = String(ev.returnValues.recipient).toLowerCase();

    const candidates = list.filter((student) => String(student.amountWei) === amount);

    const actual = list.find((student) => student.walletAddress.toLowerCase() === recipient);

    const candidatesByWallet = list.filter((student) => student.walletAddress.toLowerCase() === recipient);

    const colluderIds = withdrawerIds.filter((id: any) => !actual || id !== actual.id);
    const candidatesAfterCollusion = candidates.filter((student: any) => !colluderIds.includes(student.id));

    const guessByOrder = submissionOrder[position];
    const correctByOrder = Boolean(actual) && Boolean(guessByOrder) && (guessByOrder as any).id === actual.id;

    return {
      nullifier: String(ev.returnValues.nullifier),
      observedAmount: amount,
      observedRecipient: recipient,
      candidateIds:
        candidates.length <= 12
          ? candidates.map((student: any) => student.id).join(' ')
          : candidates
              .slice(0, 12)
              .map((student: any) => student.id)
              .join(' ') +
            ' ...(' +
            candidates.length +
            ' students)',
      actualStudentId: actual ? actual.id : 'unknown',
      actualAmountWei: actual ? String(actual.amountWei) : '',
      candidatesIncludeActual: Boolean(actual) && candidates.some((student: any) => student.id === actual.id),
      anonymitySetByAmount: candidates.length,
      uniquelyIdentifiedByAmount: candidates.length === 1,
      correctGuessByAmount: candidates.length === 1 && Boolean(actual) && candidates[0].id === actual.id,
      anonymitySetByWallet: candidatesByWallet.length,
      uniquelyIdentifiedByWallet: candidatesByWallet.length === 1,

      colluderCount: colluderIds.length,
      anonymitySetUnderFullCollusion: candidatesAfterCollusion.length,
      uniquelyIdentifiedUnderCollusion: candidatesAfterCollusion.length === 1,

      colludersNeededToDeanonymize: Math.max(0, candidates.length - 1),

      blockNumber: ev.blockNumber ?? null,
      txIndex: ev.transactionIndex ?? null,
      orderPosition: position,
      guessByOrderStudentId: guessByOrder ? (guessByOrder as any).id : 'unknown',
      correctGuessByOrder: correctByOrder,

      actualStudentIdRef: actual ? actual.id : null,
      duplicateWallets: hasDuplicateWallets,
    };
  });
}

function logStep(message: string) {
  process.stderr.write('  [' + new Date().toISOString().slice(11, 19) + '] ' + message + '\n');
}

async function retry<T>(name: string, task: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: any = null;

  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await task();
    } catch (error: any) {
      const errorCode = [error?.name, error?.code, error?.cause?.code, error?.message].filter(Boolean).join(' | ');

      const isConnectionError =
        /ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT|EPIPE/i.test(errorCode) ||
        /ServerSelection|MongoNetwork|TopologyClosed/i.test(errorCode) ||
        /Could not connect to any servers/i.test(errorCode) ||
        /ReplicaSetNoPrimary|not connected|pool.*cleared/i.test(errorCode);

      lastError = error;

      if (!isConnectionError || i === attempts) {
        throw error;
      }

      const waitMs = 3000 * Math.pow(2, i - 1);

      logStep(
        'connection error in "' +
          name +
          '" (attempt ' +
          i +
          '/' +
          attempts +
          '), retrying in ' +
          waitMs / 1000 +
          ' seconds',
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  throw lastError;
}

async function probeWalletReuse(config: AnonymityConfig, scenario: Scenario, uid: string, staff: any, list: any[]) {
  const count = Math.min(Number(scenario.walletReuseProbe), list.length);
  const secondPool: any = await retry('create second pool', () =>
    createScholarshipPool(uid, staff.FINANCE, 'Wallet reuse probe'),
  );

  await deployScholarshipPool(secondPool.poolId, staff.FINANCE, String(config.student.amountWei));

  const attempts: any[] = [];

  async function attempt(student: any, wallet: string, reusedFromFirstPool: boolean) {
    try {
      await registerStudentWallet(
        uid,
        staff.STUDENT_AFFAIRS,
        secondPool.poolId,
        student.email,
        wallet,
        student.publicKey,
      );
      attempts.push({ studentId: student.id, wallet, reusedFromFirstPool, accepted: true, error: null });
    } catch (error: any) {
      attempts.push({
        studentId: student.id,
        wallet,
        reusedFromFirstPool,
        accepted: false,
        error: String(error?.message ?? error),
      });
    }
  }

  for (const student of list.slice(0, count)) {
    await attempt(student, student.walletAddress, true);
  }

  const control = list[count] ?? list[0];
  const freshWallet = getWeb3().eth.accounts.privateKeyToAccount(
    keyFromIndex('0x3f2e5a0000000000000000000000000000000000000000000000000000000000', 0),
  ).address;

  await attempt(control, freshWallet, false);

  const reused = attempts.filter((a) => a.reusedFromFirstPool);

  return {
    secondPoolId: String(secondPool.poolId),
    reuseAttempts: reused.length,
    reuseRefused: reused.filter((a) => !a.accepted).length,
    freshWalletAccepted: attempts.some((a) => !a.reusedFromFirstPool && a.accepted),
    refusalMessages: [...new Set(reused.filter((a) => !a.accepted).map((a) => a.error))],
    attempts,
  };
}

async function runScenario(config: AnonymityConfig, scenario: Scenario) {
  logStep('reset database');
  await resetGuarded();

  await connectDatabase();

  const startedAt = Date.now();
  const accounts: string[] = await getWeb3().eth.getAccounts();
  const schoolWallet =
    config.university.walletAddress &&
    accounts.some((a) => a.toLowerCase() === String(config.university.walletAddress).toLowerCase())
      ? String(config.university.walletAddress)
      : String(accounts[0]);

  if (
    config.university.walletAddress &&
    schoolWallet.toLowerCase() !== String(config.university.walletAddress).toLowerCase()
  ) {
    process.stderr.write(
      'WARNING: the config wallet is not unlocked by the RPC, using' + ' account[0] = ' + schoolWallet + '\n',
    );
  }

  const university = await createUniversity(config.university.name, schoolWallet);
  const uid = university.universityId;

  const staff: any = await retry('seed staff', () => seedDefaultStaff(uid));
  const list = buildStudentList(config, scenario);

  for (const student of list) {
    await retry('create profile of student ' + student.id, () =>
      createStudentProfile(uid, staff.STUDENT_AFFAIRS, student.id, student.email),
    );
    await retry('approve eligibility of student ' + student.id, () =>
      approveEligibility(uid, staff.STUDENT_AFFAIRS, student.id, 'approve'),
    );
    await retry('approve finance of student ' + student.id, () =>
      approveFinance(uid, staff.FINANCE, student.id, student.amountWei),
    );
  }

  const totalAmount = list.reduce((t, student) => t + BigInt(student.amountWei), BigInt(0));
  logStep('created ' + scenario.n + ' student profiles, deploying the pool');
  const pool: any = await retry('create pool', () => createScholarshipPool(uid, staff.FINANCE));
  const deployment = await deployScholarshipPool(
    pool.poolId,
    staff.FINANCE,
    (totalAmount + BigInt(config.student.amountWei)).toString(),
  );

  for (const student of list) {
    await retry('register wallet of student ' + student.id, () =>
      registerStudentWallet(
        uid,
        staff.STUDENT_AFFAIRS,
        pool.poolId,
        student.email,
        student.walletAddress,
        student.publicKey,
      ),
    );
  }

  let issuedCount = 0;

  for (const student of list) {
    const issued: any = await retry('issue scholarship to student ' + student.id, () =>
      issueScholarship(uid, staff.STUDENT_AFFAIRS, student.id),
    );
    issuedCount += 1;

    if (issuedCount % 10 === 0) {
      logStep('issued ' + issuedCount + '/' + scenario.n);
    }

    student.cid = issued.encryptedNoteCid;
    student.commitment = issued.commitment;
    student.merkleIndex = issued.merkleIndex;
  }

  logStep('issued all ' + scenario.n + ' scholarships, approving the root');
  const rootApproval: any = await retry('approve root', () => approveRoot(pool.poolId, staff.STUDENT_AFFAIRS));

  const actualWithdrawerCount = Math.min(scenario.withdrawerCount, scenario.n);
  const withdrawers = list.slice(0, actualWithdrawerCount);

  const shuffleOn = scenario.shuffleWithdrawOrder !== false;
  const seed = scenario.shuffleSeed ?? 12345;
  const disburseOrder = shuffleOn ? shuffle(withdrawers, seed + scenario.n) : withdrawers;

  console.error('  [disbursement order] ' + (shuffleOn ? 'SHUFFLED (seed ' + seed + ')' : 'SUBMISSION ORDER KEPT'));

  for (const student of disburseOrder) {
    const note = await getStudentFromIpfs(student.cid!, student.privateKey!);
    const request: any = await retry('create withdrawal request', () =>
      createWithdrawalRequest({
        cid: student.cid,
        note,
      }),
    );
    await retry('approve and disburse', () => reviewWithdrawalRequest(request.id, staff.FINANCE, 'approve'));
    student.hasWithdrawn = true;
  }

  const contract = getPool(deployment.contractAddress);
  const events = await contract.getPastEvents('Withdraw', {
    fromBlock: 0,
    toBlock: 'latest',
  });
  const audit = observer(list, jsonSafe(events));
  const correctCount = audit.filter((x: any) => x.correctGuessByAmount).length;
  const walletReuse = scenario.walletReuseProbe ? await probeWalletReuse(config, scenario, uid, staff, list) : null;

  return {
    scenario: scenario,
    contractAddress: deployment.contractAddress,
    root: String(rootApproval.root),
    studentCount: scenario.n,
    withdrawalCount: audit.length,
    durationMs: Date.now() - startedAt,
    correctGuessesByAmount: correctCount,
    totalWithdrawals: audit.length,
    accuracyByAmount: audit.length ? correctCount / audit.length : 0,
    meanAnonymitySetByAmount: audit.length
      ? audit.reduce((t: number, x: any) => t + x.anonymitySetByAmount, 0) / audit.length
      : 0,
    correctGuessesByWallet: audit.filter((x: any) => x.uniquelyIdentifiedByWallet).length,

    shuffleWithdrawOrder: shuffleOn,
    shuffleSeed: shuffleOn ? seed + scenario.n : null,
    correctGuessesByOrder: audit.filter((x: any) => x.correctGuessByOrder).length,
    accuracyByOrder: audit.length ? audit.filter((x: any) => x.correctGuessByOrder).length / audit.length : 0,

    meanAnonymitySetUnderFullCollusion: audit.length
      ? audit.reduce((t: number, x: any) => t + x.anonymitySetUnderFullCollusion, 0) / audit.length
      : 0,
    deanonymizedUnderFullCollusion: audit.filter((x: any) => x.uniquelyIdentifiedUnderCollusion).length,
    minColludersNeededToDeanonymize: audit.length
      ? Math.min(...audit.map((x: any) => x.colludersNeededToDeanonymize))
      : 0,
    amountTiers: tierStatistics(scenario, list, audit),
    walletReuse,
    details: audit,
  };
}

async function runAnonymityExperiment(
  config: AnonymityConfig,
  outputDirectory = path.resolve(__dirname, '../../../experiments/results/anonymity'),
) {
  const OLD_KEY: Array<[string, string]> = [
    ['idBatDau', 'startingStudentId'],
    ['buocTien', 'amountStep'],
    ['kichBan', 'scenario'],
  ];

  for (const [previous, current] of OLD_KEY) {
    const hasStudentColumn = (config as any)?.student?.[previous] !== undefined;
    const hasOriginalColumn = (config as any)?.[previous] !== undefined;

    if (hasStudentColumn || hasOriginalColumn) {
      throw new Error(
        'Config still uses the OLD key `' + previous + '`. Rename it to `' + current + '` (renamed 2026-08-24).',
      );
    }
  }

  if (!config?.university?.name || !Array.isArray(config?.scenario) || config.scenario.length === 0) {
    throw new Error('Anonymity experiment configuration is incomplete');
  }

  fs.mkdirSync(outputDirectory, { recursive: true });

  const redo = process.env.RERUN === '1';

  const startedAt = new Date();
  const results = [];
  const fullPath: string[] = [];

  for (const scenario of config.scenario) {
    const fileName = 'anonymity_n' + scenario.n + scenarioLabel(scenario) + '.csv';
    const outputFile = path.join(outputDirectory, fileName);

    if (fs.existsSync(outputFile) && !redo) {
      process.stderr.write('\nSKIP (result already exists): ' + fileName + '\n');
      results.push(loadScenarioFromCsv(outputFile, scenario));
      fullPath.push(outputFile);
      continue;
    }

    process.stderr.write(
      '\n=== SCENARIO n=' +
        scenario.n +
        ' k=' +
        scenario.withdrawerCount +
        ' sameAmount=' +
        scenario.sameAmount +
        (scenario.amountTiers?.length ? ' tiers=' + scenario.amountTiers.length : '') +
        (scenario.walletReuseProbe ? ' walletReuseProbe=' + scenario.walletReuseProbe : '') +
        ' ===\n',
    );

    const r = await runScenario(config, scenario);

    results.push(r);

    const name = 'anonymity_n' + scenario.n + scenarioLabel(scenario) + '.csv';
    const header = [
      'n',
      'withdrawer_count',
      'same_amount',
      'nullifier',
      'observed_amount',
      'observed_recipient',
      'candidate_ids',
      'actual_student_id',
      'actual_amount_wei',
      'candidates_include_actual',
      'anonymity_set_by_amount',
      'uniquely_identified_by_amount',
      'correct_guess_by_amount',
      'colluder_count',
      'anonymity_set_under_full_collusion',
      'uniquely_identified_under_collusion',
      'colluders_needed_to_deanonymize',
      'shuffle_withdraw_order',
      'block_number',
      'tx_index',
      'order_position',
      'guess_by_order_student_id',
      'correct_guess_by_order',
    ];
    const rows = r.details.map((x: any) => [
      scenario.n,
      scenario.withdrawerCount,
      scenario.sameAmount,
      x.nullifier,
      x.observedAmount,
      x.observedRecipient,
      x.candidateIds,
      x.actualStudentId,
      x.actualAmountWei,
      x.candidatesIncludeActual,
      x.anonymitySetByAmount,
      x.uniquelyIdentifiedByAmount,
      x.correctGuessByAmount,
      x.colluderCount,
      x.anonymitySetUnderFullCollusion,
      x.uniquelyIdentifiedUnderCollusion,
      x.colludersNeededToDeanonymize,
      r.shuffleWithdrawOrder,
      x.blockNumber,
      x.txIndex,
      x.orderPosition,
      x.guessByOrderStudentId,
      x.correctGuessByOrder,
    ]);
    const filePath = path.join(outputDirectory, name);

    fs.writeFileSync(filePath, [header, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n', 'utf8');
    fullPath.push(filePath);

    if (r.walletReuse) {
      const reusePath = path.join(outputDirectory, 'wallet_reuse_n' + scenario.n + '.csv');
      const reuseRows = r.walletReuse.attempts.map((a: any) =>
        [
          a.studentId,
          a.wallet,
          a.reusedFromFirstPool,
          a.accepted,
          '"' + String(a.error ?? '').replace(/"/g, "'") + '"',
        ].join(','),
      );

      fs.writeFileSync(
        reusePath,
        ['student_id,wallet,reused_from_first_pool,accepted,error', ...reuseRows].join('\r\n') + '\r\n',
        'utf8',
      );
      fullPath.push(reusePath);
    }
  }

  const finishedAt = new Date();
  const summary = jsonSafe({
    metadata: {
      measurement: 'C-13 - anonymity measurement (serving C1)',
      branch: 'on-chain (ONC)',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      gitCommit: currentGitCommit(),
      measurementConditions: measurementConditions(),
    },
    threatModel: {
      observerKnows: 'the list of n students and the amount approved for each',
      observerDoesNotKnow: 'who performed which withdrawal',
      allowedSources: 'ONLY the Withdraw events and the contract state',
      forbiddenSources: 'MongoDB, IPFS, note contents, private witnesses',
      note:
        'The university is OUTSIDE this model - it is the sender of' +
        ' the transactions and therefore already knows everything.' +
        ' C1 only has meaning against a THIRD PARTY observing the chain.',

      collusionModel:
        'Attack path 3 additionally models COLLUDING WITHDRAWERS,' +
        ' as required by ISO/IEC 15408-2 (CC:2022) FPR_UNL.1' +
        ' Annex I.4.2.2. Each withdrawer privately knows their own' +
        ' nullifier, so a coalition can subtract ITSELF from the' +
        ' candidate set of any withdrawal it did not make.',
      collusionAssumption:
        'WORST CASE, not average: every other withdrawer in the run' +
        ' is assumed to collude. Chosen because it is deterministic' +
        ' - no random choice of coalition - so the number is' +
        ' reproducible across runs.',
      orderingChannel:
        'Attack path 4 models an observer who knows the SUBMISSION' +
        ' order and guesses that the i-th withdrawal on chain' +
        ' belongs to the i-th applicant. This channel exists' +
        ' because `onlySchool` routes every withdrawal through a' +
        ' single account, so one nonce sequence fixes the on-chain' +
        " order to the backend's disbursement order.",
      orderingMitigation:
        'The university SHUFFLES the approved requests before' +
        ' disbursing (scenario.shuffleWithdrawOrder, default on).' +
        ' This is an OPERATIONAL policy, not a cryptographic' +
        ' guarantee - a deployment that disburses in submission' +
        ' order leaks identity through ordering even when every' +
        ' grant carries the same amount.',
      orderingMeasurementCondition:
        'Ganache auto-mines one transaction per block, so block' +
        ' order is fully visible. On a real chain several' +
        ' withdrawals share a block and intra-block order is the' +
        " proposer's choice, making this channel weaker. Both" +
        ' block_number and tx_index are reported.',
      amountTiersModel:
        'scenario.amountTiers splits the n students into a few amount levels by share, assigned with a fixed' +
        ' seed. The observer still knows every approved amount, so the anonymity set of a withdrawal is the' +
        ' number of students in its level, not n.',
      walletReuseModel:
        'scenario.walletReuseProbe opens a SECOND pool of the same university after the withdrawals and asks' +
        ' Student Affairs to register, for that many students, the wallet they were paid to in the first pool,' +
        ' then one fresh wallet as a control. A refusal means the system itself prevents the cross-pool link.',
      collusionBound:
        'A coalition can only remove ITSELF. Students whose approved' +
        ' amount matches but who did NOT withdraw in this run stay' +
        ' in the candidate set, so the anonymity set never reaches' +
        ' zero and shrinks by at most (withdrawerCount - 1).',
    },
    results: results.map((r: any) => ({
      n: r.scenario.n,
      withdrawerCount: r.scenario.withdrawerCount,
      sameAmount: r.scenario.sameAmount,
      correctGuessesByAmount: r.correctGuessesByAmount,
      totalWithdrawals: r.totalWithdrawals,
      accuracyByAmount: r.accuracyByAmount,
      meanAnonymitySetByAmount: r.meanAnonymitySetByAmount,
      correctGuessesByWallet: r.correctGuessesByWallet,
      shuffleWithdrawOrder: r.shuffleWithdrawOrder,
      correctGuessesByOrder: r.correctGuessesByOrder,
      accuracyByOrder: r.accuracyByOrder,
      meanAnonymitySetUnderFullCollusion: r.meanAnonymitySetUnderFullCollusion,
      deanonymizedUnderFullCollusion: r.deanonymizedUnderFullCollusion,
      minColludersNeededToDeanonymize: r.minColludersNeededToDeanonymize,
      amountTiers: r.amountTiers ?? null,
      walletReuse: r.walletReuse ? { ...r.walletReuse, attempts: undefined } : null,
      durationMs: r.durationMs,
    })),
    details: results,
  });
  const summaryPath = path.join(outputDirectory, 'anonymity_summary.json');

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  return {
    summaryPath: summaryPath,
    csvPaths: fullPath,
    result: summary,
  };
}

export { runAnonymityExperiment, observer, shuffle, prngFromSeed };

if (require.main === module) {
  const configPath = process.argv[2];

  if (!configPath) {
    console.error('Usage: npm run experiment:anonymity -- <configuration.json> [outputDirectory]');
    process.exitCode = 1;
  } else {
    const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
    const outputArg = process.argv[3];

    runAnonymityExperiment(config, ...(outputArg ? [path.resolve(outputArg)] : []))
      .then((out: any) => {
        console.log('ANONYMITY SUMMARY:', out.summaryPath);

        for (const p of out.csvPaths) {
          console.log('  CSV:', p);
        }
      })
      .catch((error: any) => {
        console.error('ANONYMITY EXPERIMENT FAILED');
        console.error(error);
        process.exitCode = 1;
      })
      .finally(disconnectDatabase);
  }
}
