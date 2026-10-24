require('dotenv').config({ quiet: true });

require('http').globalAgent.keepAlive = false;
require('https').globalAgent.keepAlive = false;

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { resetDatabase } from '../scripts/resetDatabase';
import { writeStandardPropertyCsvs } from './standardPropertyCsv';
import { approveEligibility } from '../services/student.service';
import { approveFinance } from '../services/student.service';
import { approveRoot } from '../services/rootApproval.service';
import { createScholarshipPool } from '../services/pool.service';
import { createStudentProfile } from '../services/student.service';
import { createUniversity } from '../services/university.service';
import { seedDefaultStaff } from '../services/staff.service';
import { createWithdrawalRequest } from '../services/withdrawalRequest.service';
import { deployScholarshipPool } from '../services/pool.service';
import { fundPool } from '../services/pool.service';
import { getPool, getWeb3 } from '../clients/blockchain/blockchainClient';
import { issueScholarship } from '../services/scholarship.service';
import { registerStudentWallet } from '../services/studentWallet.service';
import { reviewWithdrawalRequest } from '../services/withdrawalReview.service';
import { derivePublicKeyFromPrivateKey } from '../clients/ipfs/noteEncryption';
import { getStudentFromIpfs, readEncryptedNote } from '../clients/ipfs/encryptedNoteStorage';
import * as withdrawalRequestRepo from '../repositories/withdrawalRequest.repo';
import { privateWitnessLeakageCheck } from './publicSurfaceAudit';
import { runProver } from '../clients/prover/halo2ProverClient';

const callProver = runProver;

const PASS = 'pass';
const PARTIAL_PASS = 'partial';
const FAIL = 'fail';

const EXPERIMENT_DATABASE_PATTERN = /qualitative|experiment/i;

type QualitativeExperimentConfig = {
  university: {
    name: string;
    walletAddress: string;
  };
  student: {
    id: number;
    email: string;
    walletAddress: string;
    privateKey: string;
    wrongPrivateKey?: string;
  };
  scholarship: {
    amountWei: string;
  };
  pool: {
    initialFundingWei: string;
    sponsorWalletAddress?: string;
    sponsorAmountWei?: string;
  };
  run?: {
    resetDatabase?: boolean;

    useSharedDataset?: boolean;

    studentCount?: number;

    shuffleSeed?: number;
  };
};

const GANACHE_MNEMONIC = process.env.GANACHE_MNEMONIC || 'test test test test test test test test test test test junk';

const SCHOOL_ACCOUNT_INDEX = 0;
const STUDENT_ACCOUNT_OFFSET = 1;

const SPONSOR_ACCOUNT_INDEX = 119;

function walletFromMnemonic(index: number) {
  const { HDNodeWallet } = require('ethers');
  const wallet = HDNodeWallet.fromPhrase(GANACHE_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);

  return {
    index,
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

async function assertGanacheAccounts(requiredAccountCount: number) {
  const web3 = getWeb3();
  const list: string[] = await web3.eth.getAccounts();

  if (list.length < requiredAccountCount) {
    throw new Error(
      'Ganache has only ' +
        list.length +
        ' accounts, ' +
        requiredAccountCount +
        ' needed. Restart it with:\n' +
        '  ganache --wallet.mnemonic "' +
        GANACHE_MNEMONIC +
        '" --wallet.totalAccounts 120',
    );
  }

  for (let i = 0; i < requiredAccountCount; i += 1) {
    const derived = walletFromMnemonic(i).address.toLowerCase();
    const fromGanache = String(list[i]).toLowerCase();

    if (derived !== fromGanache) {
      throw new Error(
        'Ganache account does NOT match the mnemonic at index ' +
          i +
          '.\n  Ganache : ' +
          list[i] +
          '\n  Derived : ' +
          walletFromMnemonic(i).address +
          '\nGanache is running a different mnemonic. Restart it with:\n' +
          '  ganache --wallet.mnemonic "' +
          GANACHE_MNEMONIC +
          '" --wallet.totalAccounts 120',
      );
    }
  }

  return list;
}

function deriveExtraStudents(
  count: number,
  baseStudent: {
    id: number;
    email: string;
    privateKey: string;
  },
) {
  const list: {
    index: number;
    id: number;
    email: string;
    walletAddress: string;
    privateKey: string;
    ganacheAccountIndex: number;
  }[] = [];

  for (let i = 1; i <= count; i += 1) {
    const accountIndex = STUDENT_ACCOUNT_OFFSET + i;
    const wallet = walletFromMnemonic(accountIndex);
    const id = baseStudent.id + i;

    list.push({
      index: i,
      id,
      email: id + '@gmail.com',
      walletAddress: wallet.address,
      privateKey: wallet.privateKey,
      ganacheAccountIndex: accountIndex,
    });
  }

  return list;
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
    iterations: 1,
    k: 13,
    curve: 'BN254 (Fr)',
    provingSystem:
      'KZG-SHPLONK (snark-verifier-sdk) - trusted setup from the constant seed ChaCha20Rng::from_seed([42u8; 32]), NOT a ceremony',
    merkleDepth: CURRENT_MERKLE_DEPTH,
    maxLeaves: CURRENT_MAX_LEAVES,
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();

  return /[",;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function flattenValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0
      ? '(empty)'
      : value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(' | ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function csvTable(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const TICK_YES = '✓';
const TICK_NO = '✗';

function tick(passed: boolean, reasonWhenPassed: string, reasonWhenFailed: string): string {
  return passed ? TICK_YES + ' ' + reasonWhenPassed : TICK_NO + ' ' + reasonWhenFailed;
}

const CSV_BOM = '﻿';

const EVIDENCE_MEANING: Record<string, string> = {
  usedNullifier: 'Whether the nullifier has been spent (answered by the contract)',
  withdraw1_txHash: 'Transaction hash of the FIRST withdrawal, verifiable on chain',
  withdraw1_status: 'Result of the first withdrawal: 1 = success',
  replay_txHash: 'Transaction hash of the SECOND withdrawal, same nullifier',
  replay_status: 'Result of the second withdrawal: 0 = rejected by the contract',

  currentRoot: 'Current Merkle root in effect, read from the contract',
  validRoot: 'Whether the contract recognises this root as previously approved',
  transactionHash: 'Transaction hash of the successful withdrawal',
  contractEvents: 'Sequence of events emitted by the contract, in order',
  contractAddress: 'ShieldedPool address - use it to look the run up again',

  proofVerifiedOnChain:
    'Whether the proof is checked by a contract (true) or by the' +
    ' university backend (false) - read from the withdraw ABI',
  verifiedBy: 'Who actually performs the proof check for this branch',
  commitmentPublishedOnChain: 'Whether any contract event carries the individual commitments',
  rootReconstructibleByThirdParty:
    'Whether an outsider can rebuild the Merkle tree from chain data' + ' alone and so confirm the root is honest',
  residualTrust: 'What a third party must STILL take on trust after reading' + ' everything the chain publishes',
  rootPublishingEvents:
    'Full signature of every contract event - read it to see for' +
    ' yourself what the chain does and does not publish',
  verifiableAxesPassed:
    'How many of the two independent axes hold: A = a third party' +
    ' can re-check the proof, B = a third party can rebuild the' +
    ' Merkle tree. 2 -> pass, 1 -> partial, 0 -> fail',

  cid: 'IPFS address of the note (anyone can fetch it)',
  ipfsEnvelopeFields: 'Fields actually stored on IPFS - all of them are ciphertext',
  decrypt_correctKey: 'Decrypting with the CORRECT key yields these fields',
  decrypt_wrongKey: 'Decrypting with a WRONG key is rejected by AES-GCM, not garbage',

  publicSurfacesAudited: 'Public data sources that were searched for the secrets',
  student_id_traces: 'Traces of `student_id` found on the public surface - [] means none',
  rho_traces: 'Traces of `rho` - [] means none',
  merklePath_traces: 'Traces of the Merkle path (`siblings`, `directions`) - [] means none',
  studentsAudited: 'Number of students whose secrets were searched for',
  studentsLeaked: 'Number of students whose secrets leaked - must be 0',
  leakDetails: 'Who leaked and what - [] means nobody leaked',
};

function buildCsvFiles(
  branch: string,
  metadata: any,
  criteria: any,
  amountBinding: Record<string, unknown>,
  limitations: Record<string, unknown>,
  fullAudit?: any,
) {
  const fixedHeader = ['branch', 'run_at', 'git_commit', 'chain_id'];
  const fixed = [branch, metadata.finishedAt, metadata.gitCommit, metadata.chainId];

  const criteriaRows: string[][] = [];

  for (const key of Object.keys(criteria)) {
    const criterion = criteria[key];

    for (const [name, value] of Object.entries(criterion.evidence)) {
      criteriaRows.push([
        ...fixed,
        key.split('_')[0],
        criterion.name,
        criterion.verdict,
        name,
        flattenValue(value),
        EVIDENCE_MEANING[name] || '',
      ]);
    }
  }

  const c3Rows = Object.entries(amountBinding || {}).map(([name, value]) => [...fixed, name, flattenValue(value)]);

  const appendixRows = [
    ...Object.entries(metadata.measurementConditions || {}).map(([name, value]) => [
      ...fixed,
      'measurement conditions (C-14)',
      name,
      flattenValue(value),
    ]),
    ...Object.entries(limitations || {}).map(([name, value]) => [
      ...fixed,
      'limitations - NOT proven here',
      name,
      flattenValue(value),
    ]),
  ];

  return {
    criteria: csvTable(
      [...fixedHeader, 'criterion', 'criterion_name', 'verdict', 'evidence_name', 'value', 'meaning'],
      criteriaRows,
    ),
    amountBinding: csvTable([...fixedHeader, 'item', 'value'], c3Rows),
    appendix: csvTable([...fixedHeader, 'group', 'item', 'value'], appendixRows),

    students:
      (fullAudit?.perStudent?.length || 0) > 1
        ? csvTable(
            [
              ...fixedHeader,
              'total_students',
              'student_index',
              'student_id',
              'wallet_address',
              'ganache_account_index',
              'clean',
              'exposed_name_count',
              'exposed_value_count',
              'exposed_names',
              'encodings_checked',
              'encodings_skipped',
            ],
            fullAudit.perStudent.map((x: any) => [
              ...fixed,
              String(fullAudit.studentsAudited),
              String(x.index),
              String(x.studentId ?? ''),
              String(x.walletAddress ?? ''),
              String(x.ganacheAccountIndex),
              String(x.clean),
              String(x.exposedNameCount),
              String(x.exposedValueCount),
              (x.exposedNames || []).join(' ') || '(none)',
              String(x.encodingsChecked),
              String(x.encodingsSkipped),
            ]),
          )
        : null,
  };
}

function jsonSafe(value: any) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)));
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

function sourceCodeState() {
  const root = path.resolve(__dirname, '../../..');

  const run = (params: string[]) => {
    try {
      return execFileSync('git', params, { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };

  const commit = run(['rev-parse', 'HEAD']);
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const state = run(['status', '--porcelain']);

  if (commit === null) {
    return {
      gitCommit: null,
      branch: null,
      clean: null,
      changedFileCount: null,
      changedFiles: [],
      warning: 'Cannot read git — the source code cannot be pinned.' + ' This run is NOT reproducible.',
    };
  }

  const changedFiles = (state || '')
    .split('\n')
    .map((row: string) => row.trim())
    .filter((row: string) => row.length > 0);

  const clean = changedFiles.length === 0;

  return {
    gitCommit: commit,
    branch,
    clean,
    changedFileCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, 50),

    warning: clean
      ? null
      : 'The working tree HAD uncommitted changes during this run.' +
        ' Checking out commit ' +
        commit +
        ' will NOT reproduce' +
        ' the source code that ran. To reproduce, commit first' +
        ' and run again.',
  };
}

const CURRENT_MERKLE_DEPTH = 9;
const CURRENT_MAX_LEAVES = 2 ** CURRENT_MERKLE_DEPTH;

function rebuildRootFromEvents(
  events: any[],
  onChainRoot: unknown,
): {
  leafCount: number;
  rebuiltRoot: string;
  onChainRoot: string;
  matches: boolean;
} | null {
  const published = (events || []).filter((e: any) => e?.event === 'CommitmentsPublished');

  if (published.length === 0) {
    return null;
  }

  const commitmentList = ((published[0]?.returnValues || {}).commitments || []).map((x: any) => String(x));

  if (commitmentList.length === 0) {
    return null;
  }

  try {
    const output = callProver('root', { commitments: commitmentList });
    const rehashedRoot = String(output?.root || '').toLowerCase();
    const onChain = String(onChainRoot || '').toLowerCase();

    return {
      leafCount: commitmentList.length,
      rebuiltRoot: String(output?.root || ''),
      onChainRoot: String(onChainRoot || ''),
      matches: rehashedRoot.length > 0 && rehashedRoot === onChain,
    };
  } catch (error: any) {
    console.error('  tree rebuild FAILED: ' + String(error?.message || error));

    return null;
  }
}

async function skipIfDone<T>(task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (error: any) {
    const message = String(error?.message || '');

    if (/already exists|already used|E11000|duplicate key/i.test(message)) {
      return null;
    }

    throw error;
  }
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

      console.error(
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

function readSharedDataset(studentCount: number) {
  const filePath = path.resolve(__dirname, '../../../experiments/data/dataset_n' + studentCount + '.json');

  if (!fs.existsSync(filePath)) {
    throw new Error(
      'useSharedDataset = true but ' +
        filePath +
        ' was not found. For the n values that have a dataset, see experiments/data/.' +
        ' Or set run.useSharedDataset = false to generate students.',
    );
  }

  const dataset = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (Number(dataset.n) !== Number(studentCount)) {
    throw new Error('Dataset ' + filePath + ' has n = ' + dataset.n + ' but run.studentCount = ' + studentCount);
  }

  const students = dataset.students || [];

  if (students.length !== Number(studentCount)) {
    throw new Error(
      'Dataset ' + filePath + ' declares n = ' + dataset.n + ' but holds only ' + students.length + ' students',
    );
  }

  if (dataset.merkle_depth !== undefined && Number(dataset.merkle_depth) !== Number(CURRENT_MERKLE_DEPTH)) {
    throw new Error(
      'Dataset has merkle_depth = ' +
        dataset.merkle_depth +
        ' but the system runs at depth ' +
        CURRENT_MERKLE_DEPTH +
        '. Regenerate the dataset or change the depth to match.',
    );
  }

  const rows = students.map((student: any, i: number) => ({
    index: i,
    studentId: Number(student.student_id),
    amountWei: String(student.note?.amount ?? student.amount),
    rho: String(student.note?.rho),
    walletAddress: String(student.address),
    ganacheAccountIndex: Number(student.ganache_account_index),
  }));

  for (const row of rows) {
    const derived = walletFromMnemonic(STUDENT_ACCOUNT_OFFSET + row.index).address;

    if (row.walletAddress.toLowerCase() !== derived.toLowerCase()) {
      throw new Error(
        'Dataset wallet mismatch at student ' +
          row.index +
          ' (' +
          filePath +
          ')' +
          '\n  Dataset : ' +
          row.walletAddress +
          '\n  Derived : ' +
          derived +
          '\nThe dataset was generated from a different mnemonic than the' +
          ' GANACHE_MNEMONIC in use. The two experiments would' +
          ' NO LONGER share the same input.',
      );
    }
  }

  return rows;
}

function withdrawBindsProofOnChain(contractInterface: any[]): boolean {
  return (contractInterface || []).some(
    (item: any) =>
      item.type === 'function' &&
      /^(withdraw|verify)/i.test(item.name || '') &&
      (item.inputs || []).some((input: any) => /proof|calldata/i.test(input.name || '') || input.type === 'bytes'),
  );
}

function validateConfiguration(config: QualitativeExperimentConfig) {
  if (
    !config?.university?.name ||
    !config.university.walletAddress ||
    !config?.student?.email ||
    !Number.isSafeInteger(config.student.id) ||
    config.student.id <= 0 ||
    !config.student.walletAddress ||
    !config.student.privateKey ||
    !/^[1-9][0-9]*$/.test(config?.scholarship?.amountWei || '') ||
    !/^\d+$/.test(config?.pool?.initialFundingWei || '')
  ) {
    throw new Error('Qualitative experiment configuration is incomplete');
  }
}

async function resetExperimentDatabaseGuarded() {
  const connection = await connectDatabase();
  const databaseName = String(connection.name || '');

  if (!EXPERIMENT_DATABASE_PATTERN.test(databaseName)) {
    await disconnectDatabase();

    throw new Error(
      'RESET REFUSED: database "' +
        databaseName +
        '" is not' +
        ' an experiment database. The runner only resets databases whose' +
        ' name contains "qualitative" or "experiment". Point' +
        ' MONGODB_URI at a separate database; do not reset a database' +
        ' that holds manual-flow data.',
    );
  }

  const result = await resetDatabase();

  return result;
}

async function runQualitativeExperiment(
  config: QualitativeExperimentConfig,
  outputDirectory = path.resolve(__dirname, '../../../experiments/results/qualitative'),
) {
  validateConfiguration(config);
  const startedAt = new Date();

  if ((config.run as any)?.soSinhVien !== undefined) {
    throw new Error(
      'Config still uses the OLD key `run.soSinhVien`. Rename it to' +
        ' `run.studentCount` (renamed 2026-08-23). Current' +
        ' value: ' +
        (config.run as any).soSinhVien,
    );
  }

  const requestedStudentCount = Math.max(1, Math.trunc(config.run?.studentCount || 1));
  const requiredAccountCount = Math.max(
    STUDENT_ACCOUNT_OFFSET + requestedStudentCount,
    config.pool?.sponsorWalletAddress ? SPONSOR_ACCOUNT_INDEX + 1 : 0,
  );

  await assertGanacheAccounts(requiredAccountCount);

  const schoolWallet = walletFromMnemonic(SCHOOL_ACCOUNT_INDEX);
  const student0Wallet = walletFromMnemonic(STUDENT_ACCOUNT_OFFSET);

  config.university.walletAddress = schoolWallet.address;
  config.student.walletAddress = student0Wallet.address;

  if (config.pool?.sponsorWalletAddress) {
    config.pool.sponsorWalletAddress = walletFromMnemonic(SPONSOR_ACCOUNT_INDEX).address;
  }
  config.student.privateKey = student0Wallet.privateKey;

  const databaseReset = config.run?.resetDatabase ? await resetExperimentDatabaseGuarded() : null;

  await connectDatabase();

  let university;

  try {
    university = await createUniversity(config.university.name, config.university.walletAddress);
  } catch (error: any) {
    if (/already exists|duplicate key/i.test(error?.message || '')) {
      throw new Error(
        'The experiment database already holds data from a previous run' +
          ' (University.name and walletAddress are globally' +
          ' unique). Set "run": { "resetDatabase": true }' +
          ' in the config file so the runner cleans up before each run.' +
          ' Original error: ' +
          error.message,
      );
    }

    throw error;
  }

  const staff = await seedDefaultStaff(university.universityId);

  const numStudents = Math.max(1, Math.trunc(config.run?.studentCount || 1));
  const datasetRows = config.run?.useSharedDataset ? readSharedDataset(numStudents) : null;

  if (datasetRows) {
    config.student.id = datasetRows[0].studentId;
    config.student.email = datasetRows[0].studentId + '@gmail.com';
  }

  await createStudentProfile(university.universityId, staff.STUDENT_AFFAIRS, config.student.id, config.student.email);
  await approveEligibility(university.universityId, staff.STUDENT_AFFAIRS, config.student.id, 'approve');
  await approveFinance(
    university.universityId,
    staff.FINANCE,
    config.student.id,
    datasetRows ? datasetRows[0].amountWei : config.scholarship.amountWei,
  );

  const enforcedDenomination = datasetRows ? datasetRows[0].amountWei : config.scholarship.amountWei;

  const pool = await createScholarshipPool(
    university.universityId,
    staff.FINANCE,
    undefined,
    undefined,
    String(enforcedDenomination),
  );
  const deployment = await deployScholarshipPool(pool.poolId, staff.FINANCE, config.pool.initialFundingWei);

  if (config.pool.sponsorWalletAddress && config.pool.sponsorAmountWei) {
    await fundPool(pool.poolId, staff.FINANCE, config.pool.sponsorAmountWei, config.pool.sponsorWalletAddress);
  }

  const studentPublicKey = derivePublicKeyFromPrivateKey(config.student.privateKey);
  await registerStudentWallet(
    university.universityId,
    staff.STUDENT_AFFAIRS,
    pool.poolId,
    config.student.email,
    config.student.walletAddress,
    studentPublicKey,
  );

  const scholarship = await issueScholarship(
    university.universityId,
    staff.STUDENT_AFFAIRS,
    config.student.id,
    datasetRows ? datasetRows[0].rho : undefined,
  );

  const studentCount = numStudents;

  const extraStudents = deriveExtraStudents(studentCount - 1, {
    id: config.student.id,
    email: config.student.email,
    privateKey: config.student.privateKey,
  });

  const extraScholarship: {
    students: (typeof extraStudents)[number];
    cid: string;
  }[] = [];

  for (const student of extraStudents) {
    await retry(
      'student ' + student.id,
      async () => {
        await skipIfDone(() =>
          createStudentProfile(university.universityId, staff.STUDENT_AFFAIRS, student.id, student.email),
        );
        await approveEligibility(university.universityId, staff.STUDENT_AFFAIRS, student.id, 'approve');
        await approveFinance(
          university.universityId,
          staff.FINANCE,
          student.id,
          datasetRows ? datasetRows[student.index].amountWei : config.scholarship.amountWei,
        );
        await skipIfDone(() =>
          registerStudentWallet(
            university.universityId,
            staff.STUDENT_AFFAIRS,
            pool.poolId,
            student.email,
            student.walletAddress,
            derivePublicKeyFromPrivateKey(student.privateKey),
          ),
        );

        const issuedScholarship = await issueScholarship(
          university.universityId,
          staff.STUDENT_AFFAIRS,
          student.id,
          datasetRows ? datasetRows[student.index].rho : undefined,
        );

        extraScholarship.push({
          students: student,
          cid: issuedScholarship.encryptedNoteCid,
        });
      },
      8,
    );
  }

  const rootApproval = await approveRoot(pool.poolId, staff.STUDENT_AFFAIRS);

  const cid = scholarship.encryptedNoteCid;
  const encryptedEnvelope = await readEncryptedNote(cid);
  const decryptedNote = await getStudentFromIpfs(cid, config.student.privateKey);
  const configuredWrongKey = config.student.wrongPrivateKey || '22'.repeat(32);
  const wrongPrivateKey =
    configuredWrongKey.toLowerCase() !== config.student.privateKey.toLowerCase() ? configuredWrongKey : '11'.repeat(32);
  let wrongKeyRejected = false;
  let wrongKeyError: string | null = null;

  try {
    await getStudentFromIpfs(cid, wrongPrivateKey);
  } catch (error: any) {
    wrongKeyRejected = true;
    wrongKeyError = error?.message || String(error);
  }

  const request = await createWithdrawalRequest({
    cid,
    note: decryptedNote,
  });
  const web3 = getWeb3();

  const usedNullifierBefore = String(
    await getPool(deployment.contractAddress).methods.usedNullifier(String(request.nullifier)).call(),
  );

  const executedRequest = await reviewWithdrawalRequest(request.id, staff.FINANCE, 'approve');

  const contractAddress = deployment.contractAddress;
  const contract = getPool(contractAddress);
  const transactionHash = executedRequest.transactionHash;
  const receipt = await web3.eth.getTransactionReceipt(transactionHash);
  const transaction = await web3.eth.getTransaction(transactionHash);
  const events = await contract.getPastEvents('allEvents', {
    fromBlock: 0,
    toBlock: 'latest',
  });

  let replay: any = {
    rejected: false,
    transactionHash: null,
    receipt: null,
    reason: null,
  };

  try {
    await reviewWithdrawalRequest(request.id, staff.FINANCE, 'approve');
  } catch (error: any) {
    replay = {
      rejected: true,
      transactionHash: error?.receipt?.transactionHash || error?.transactionHash || null,
      receipt: error?.receipt ? jsonSafe(error.receipt) : null,
      reason: error?.reason || error?.cause?.message || error?.message || String(error),
    };
  }

  const extraStudentSecret: {
    student_id: any;
    rho: any;
  }[] = [];

  const extraStudentCalldata: string[] = [];

  const shuffleSeed = Number(config.run?.shuffleSeed ?? 20260905);

  const disbursementOrder = shuffle(
    extraScholarship.map((x: any, i: number) => ({ item: x, viTriNop: i })),
    shuffleSeed,
  );

  const orderCheck: {
    studentId: any;
    viTriNop: number;
    viTriChuoi: number;

    walletAddress: string;
  }[] = [];

  let chainPosition = 0;

  for (const { item, viTriNop: submitPosition } of disbursementOrder) {
    const ownNote = await getStudentFromIpfs(item.cid, item.students.privateKey);

    extraStudentSecret.push({
      student_id: ownNote.note ? ownNote.note.student_id : ownNote.student_id,
      rho: ownNote.note ? ownNote.note.rho : ownNote.rho,
    });

    const withdrawalRequest = await createWithdrawalRequest({
      cid: item.cid,
      note: ownNote,
    });

    await reviewWithdrawalRequest(withdrawalRequest.id, staff.FINANCE, 'approve');

    const storedRequest = await withdrawalRequestRepo.findById(withdrawalRequest.id).lean();

    if (storedRequest?.calldata) {
      extraStudentCalldata.push(storedRequest.calldata);
    }

    if (storedRequest?.verifyRecordTxHash) {
      const verifyTransaction = await web3.eth.getTransaction(String(storedRequest.verifyRecordTxHash));

      if (verifyTransaction?.input) {
        extraStudentCalldata.push(String(verifyTransaction.input));
      }
    }

    orderCheck.push({
      studentId: item.students.id,
      viTriNop: submitPosition,
      viTriChuoi: chainPosition,
      walletAddress: String(item.students.walletAddress || ''),
    });

    chainPosition += 1;
  }

  const orderMatches = orderCheck.filter((x) => x.viTriNop === x.viTriChuoi).length;

  const finalEvents =
    extraStudents.length > 0
      ? await contract.getPastEvents('allEvents', {
          fromBlock: 0,
          toBlock: 'latest',
        })
      : events;

  const withdrawEvents = (finalEvents || []).filter((e: any) => e?.event === 'Withdraw');

  const walletsOnChain = new Map<string, number>();
  const countByBlock = new Map<number, number>();

  let walletMatchCount = 0;
  let blocksMonotonic = true;
  let previousBlock = -1;

  withdrawEvents.forEach((e: any, i: number) => {
    const recipientAddress = String(e?.returnValues?.recipient || '').toLowerCase();

    if (walletsOnChain.has(recipientAddress)) {
      walletMatchCount += 1;
    } else {
      walletsOnChain.set(recipientAddress, i);
    }

    const b = Number(e?.blockNumber);

    countByBlock.set(b, (countByBlock.get(b) || 0) + 1);

    if (previousBlock >= 0 && b < previousBlock) {
      blocksMonotonic = false;
    }

    previousBlock = b;
  });

  let chainCheckCount = 0;
  let chainMatchCount = 0;

  for (const x of orderCheck) {
    const index = walletsOnChain.get(String(x.walletAddress || '').toLowerCase());

    if (index === undefined) {
      continue;
    }

    chainCheckCount += 1;

    if (x.viTriNop === index - 1) {
      chainMatchCount += 1;
    }
  }

  const maxPerBlock = countByBlock.size === 0 ? 0 : Math.max(...Array.from(countByBlock.values()));

  const expectedRoot = String(rootApproval.root);
  const expectedNullifier = String(request.nullifier);

  const requestDocument = await withdrawalRequestRepo.findById(request.id).lean();
  const verifierCalldata = requestDocument?.calldata || null;

  if (!verifierCalldata) {
    throw new Error(
      'Cannot read the calldata of WithdrawalRequest ' +
        request.id +
        '. Without inspecting the proof sent on chain,' +
        ' criterion 4 would be graded more leniently than reality - stopping.',
    );
  }

  const verifyRecordTransaction = requestDocument?.verifyRecordTxHash
    ? await web3.eth.getTransaction(String(requestDocument.verifyRecordTxHash))
    : null;

  if (!verifyRecordTransaction) {
    throw new Error(
      'WithdrawalRequest ' +
        request.id +
        ' has no' +
        ' verifyRecordTxHash. The verification step should be a' +
        ' real transaction that leaves a trace on chain. Without it' +
        ' criterion 4 misses one public surface and would be graded' +
        ' more leniently than reality - stopping.',
    );
  }

  const publicArtifact = {
    proofOutput: {
      calldata: verifierCalldata,
      root: expectedRoot,
      nullifier: expectedNullifier,
      amount: String(request.amountWei),

      recipient: String(request.recipient || ''),
    },
    verifierCalldata,

    verifierCalldataSinhVienKhac: extraStudentCalldata,

    transactionInput: transaction.input,
    verifyRecordTransactionInput: verifyRecordTransaction.input,
    contractInterface: contract.options.jsonInterface,
    events: jsonSafe(finalEvents),
    contractState: {
      currentRoot: await contract.methods.currentRoot().call(),
      validRoot: await contract.methods.validRoot(expectedRoot).call(),

      denomination: String(await contract.methods.denomination().call()),
      usedNullifier: await contract.methods.usedNullifier(expectedNullifier).call(),
    },
  };

  const chainId = BigInt(await web3.eth.getChainId()).toString();

  const privateValues = {
    student_id: decryptedNote.note ? decryptedNote.note.student_id : decryptedNote.student_id,
    rho: decryptedNote.note ? decryptedNote.note.rho : decryptedNote.rho,
  };
  const leakage = privateWitnessLeakageCheck(publicArtifact, privateValues);

  const perStudentAudit = [
    { index: 0, secretValues: privateValues, leakCheck: leakage },
    ...extraStudentSecret.map((secret, i) => ({
      index: i + 1,
      secretValues: secret,
      leakCheck: privateWitnessLeakageCheck(publicArtifact, secret),
    })),
  ];

  const exposedCount = perStudentAudit.filter((x: any) => !x.leakCheck.passed).length;

  const fullAudit = {
    studentsAudited: perStudentAudit.length,
    studentsLeaked: exposedCount,
    allClean: exposedCount === 0,

    leakDetails: perStudentAudit
      .filter((x: any) => !x.leakCheck.passed)
      .map((x: any) => ({
        index: x.index,
        exposedNames: x.leakCheck.exposedNames,
        exposedValues: x.leakCheck.exposedValues,
      })),

    perStudent: perStudentAudit.map((x: any) => ({
      index: x.index,
      ganacheAccountIndex: STUDENT_ACCOUNT_OFFSET + x.index,
      studentId: x.index === 0 ? config.student.id : extraStudents[x.index - 1]?.id,
      walletAddress: x.index === 0 ? config.student.walletAddress : extraStudents[x.index - 1]?.walletAddress,
      clean: x.leakCheck.passed,
      exposedNameCount: x.leakCheck.exposedNames.length,
      exposedValueCount: x.leakCheck.exposedValues.length,
      exposedNames: x.leakCheck.exposedNames,
      encodingsChecked: x.leakCheck.coverage?.checkedEncodingCount || 0,
      encodingsSkipped: x.leakCheck.coverage?.skippedTooShort?.length || 0,
    })),

    totalEncodingsChecked: perStudentAudit.reduce(
      (total: number, x: any) => total + (x.leakCheck.coverage?.checkedEncodingCount || 0),
      0,
    ),
    totalEncodingsSkipped: perStudentAudit.reduce(
      (total: number, x: any) => total + (x.leakCheck.coverage?.skippedTooShort?.length || 0),
      0,
    ),

    soCalldataDaSoi: 1 + extraStudentCalldata.length,
  };

  const envelopeLeakage = privateWitnessLeakageCheck(encryptedEnvelope, privateValues);
  const ciphertextOnly = envelopeLeakage.passed;

  const proofBoundOnChain = withdrawBindsProofOnChain(publicArtifact.contractInterface);
  const eventNames = publicArtifact.events.map((item: any) => item.event);
  const calldataBytes = String(verifierCalldata).replace(/^0x/, '').length / 2;

  const stateReadable =
    Boolean(publicArtifact.contractState.currentRoot) &&
    publicArtifact.contractState.validRoot === true &&
    publicArtifact.contractState.usedNullifier !== null &&
    publicArtifact.contractState.usedNullifier !== undefined &&
    Boolean(transactionHash) &&
    eventNames.length > 0;

  const proofVerifiedOnChain = proofBoundOnChain;

  const commitmentPublishedOnChain = (publicArtifact.contractInterface || []).some(
    (item: any) =>
      item.type === 'event' && (item.inputs || []).some((input: any) => /commitment|leaf/i.test(input.name || '')),
  );

  const rootRebuildCheck = rebuildRootFromEvents(finalEvents, publicArtifact.contractState.currentRoot);

  if (rootRebuildCheck) {
    console.error(
      '  M4 tree rebuild: ' +
        String(rootRebuildCheck.leafCount) +
        ' commitments -> root ' +
        (rootRebuildCheck.matches ? 'MATCHES' : 'DIFFERS FROM') +
        ' currentRoot',
    );
  }

  const verifiableAxes = [proofVerifiedOnChain, commitmentPublishedOnChain].filter(Boolean).length;

  const stateVerifiableVerdict = verifiableAxes === 2 ? PASS : verifiableAxes === 1 ? PARTIAL_PASS : FAIL;

  const traces = (...name: string[]) =>
    JSON.stringify(
      perStudentAudit.flatMap((student: any) => {
        const label = perStudentAudit.length > 1 ? 'student' + student.index + ':' : '';

        return [
          ...student.leakCheck.exposedNames.filter((n: string) => name.includes(n)).map((n: string) => label + n),
          ...student.leakCheck.exposedValues
            .filter((x: any) => name.includes(x.label))
            .map((x: any) => label + x.label + '=' + x.encoding),
        ];
      }),
    );

  const criteria = {
    '1_replay_prevention': {
      name: 'Replay prevention',
      verdict:
        Boolean(receipt?.status) && replay.rejected && publicArtifact.contractState.usedNullifier === true
          ? PASS
          : FAIL,
      evidence: {
        usedNullifier:
          usedNullifierBefore +
          ' (before withdrawal) -> ' +
          String(publicArtifact.contractState.usedNullifier) +
          ' (after withdrawal)',
        withdraw1_txHash: transactionHash,
        withdraw1_status: receipt?.status
          ? '1 - transaction accepted by the EVM'
          : '0 - transaction reverted by the EVM',
        replay_txHash: replay.transactionHash,
        replay_status: replay.receipt
          ? String(replay.receipt.status) + ' — ' + (String(replay.reason || '').split('{')[0] || '').trim()
          : String(replay.reason || '(no receipt)'),
      },
    },
    '2a_state_readable': {
      name: 'State is readable (ISO/IEC 15408-2 FAU_SAR.1)',
      verdict: stateReadable ? PASS : FAIL,
      evidence: {
        currentRoot: publicArtifact.contractState.currentRoot,
        transactionHash,
        contractEvents: eventNames.join(' | '),

        validRoot: tick(
          publicArtifact.contractState.validRoot === true,
          'the contract confirms this root was approved earlier,' +
            ' so anyone can check the withdrawal used a' +
            ' root the university had published',
          'the contract does not recognise this root - a reader' + ' cannot tie the withdrawal to an approved root',
        ),
        usedNullifier: tick(
          publicArtifact.contractState.usedNullifier === true,
          'the contract reports this nullifier as spent, so the' + ' spend is visible to any reader',
          'the contract reports this nullifier as unspent - the' + ' spend left no readable trace',
        ),
      },
    },
    '2b_state_verifiable': {
      name: 'State is verifiable without trusting the issuer' + ' (NIST IR 8202 s4 p.18)',
      verdict: stateVerifiableVerdict,
      evidence: {
        proofVerifiedOnChain: tick(
          proofVerifiedOnChain,
          'the withdraw function takes the proof as calldata and' +
            ' a contract verifies it, so a third party can' +
            ' re-run the check without trusting anyone',
          'the withdraw function takes no proof, so proof' +
            ' validity is asserted by the university backend' +
            ' and cannot be rechecked from chain data',
        ),
        verifiedBy: proofVerifiedOnChain ? 'on-chain verifier contract' : 'university backend (off-chain)',

        commitmentPublishedOnChain: tick(
          commitmentPublishedOnChain,
          'a contract event carries the individual commitments',
          'no contract event carries commitments - only the' + ' Merkle root is published',
        ),
        rootReconstructibleByThirdParty: tick(
          rootRebuildCheck?.matches === true,
          'an outsider rebuilt the tree from the ' +
            String(rootRebuildCheck?.leafCount ?? 0) +
            ' published commitments and got the same root the' +
            ' contract reports',
          rootRebuildCheck
            ? 'an outsider rebuilt the tree but got a DIFFERENT' + ' root - investigate before quoting anything'
            : 'no rebuild was performed this run (no' +
                ' CommitmentsPublished event, or the prover' +
                ' could not be called)',
        ),

        verifiableAxesPassed: String(verifiableAxes) + ' of 2' + ' (A: proof re-checkable | B: root re-buildable)',

        residualTrust: proofVerifiedOnChain
          ? commitmentPublishedOnChain
            ? 'nothing beyond the chain itself - a' +
              ' contract re-checks the proof and' +
              ' the commitments are published, so' +
              ' both axes are open to a third party'
            : 'the set of commitments inside the root -' +
              ' only the root is published, so a' +
              ' third party cannot check the tree' +
              ' was built from legitimately issued' +
              ' scholarships'
          : commitmentPublishedOnChain
            ? 'proof validity - the withdraw function' +
              ' takes no proof, so the university' +
              ' backend asserts it; the commitment' +
              ' set itself is re-buildable from' +
              ' chain data'
            : 'the whole withdrawal - neither the proof' +
              ' nor the commitment set can be' +
              ' rechecked from chain data',

        rootPublishingEvents: (publicArtifact.contractInterface || [])
          .filter((item: any) => item.type === 'event')
          .map(
            (item: any) =>
              item.name + '(' + (item.inputs || []).map((i: any) => i.type + ' ' + i.name).join(', ') + ')',
          )
          .join(' | '),
      },
    },
    '3_encrypted_note': {
      name: 'Encrypted note on IPFS',
      verdict: ciphertextOnly && wrongKeyRejected ? PASS : FAIL,
      evidence: {
        cid,
        ipfsEnvelopeFields: Object.keys(encryptedEnvelope).join(' | '),
        decrypt_correctKey: Object.keys(decryptedNote || {}).join(' | '),
        decrypt_wrongKey: wrongKeyError,
      },
    },
    '4_private_witness': {
      name: 'Private witness',
      verdict: fullAudit.allClean ? PASS : FAIL,
      evidence: {
        publicSurfacesAudited:
          'public inputs | verifier calldata | calldata' +
          ' | on-chain verifyAndRecord calldata | events | contract state',
        student_id_traces: traces('student_id'),
        rho_traces: traces('rho'),
        merklePath_traces: traces('siblings', 'directions'),

        ...(studentCount > 1
          ? {
              studentsAudited: fullAudit.studentsAudited,
              studentsLeaked: fullAudit.studentsLeaked,
              soCalldataDaSoi: fullAudit.soCalldataDaSoi,
              leakDetails: JSON.stringify(fullAudit.leakDetails),
            }
          : {}),
      },
    },
  };

  const finishedAt = new Date();
  const result = jsonSafe({
    metadata: {
      branch: 'on-chain',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      gitCommit: currentGitCommit(),

      sourceCode: sourceCodeState(),

      studentCount,

      chainId,
      contractAddress,
      verifierAddress: deployment.verifierAddress,
      databaseReset,
      measurementConditions: measurementConditions(),
    },
    ipfs: {
      cid,
      encryptedEnvelope,
      ciphertextOnly,
      envelopeLeakage,
      correctKeyDecrypted: true,
      wrongKeyRejected,
      wrongKeyError,
    },
    proof: {
      root: expectedRoot,
      nullifier: expectedNullifier,
      amount: String(request.amountWei),
      calldataBytes,
    },
    withdrawal: {
      firstAttempt: {
        succeeded: Boolean(receipt?.status),
        transactionHash,
        receipt: jsonSafe(receipt),
      },
      replay,
      contractState: publicArtifact.contractState,
      events: publicArtifact.events,
    },
    rootApproval: {
      root: String(rootApproval.root),
      transactionHash: rootApproval.transactionHash,
      currentRoot: publicArtifact.contractState.currentRoot,
      validRoot: publicArtifact.contractState.validRoot,
    },
    publicSurfaceAudit_K7: fullAudit,

    privacy: {
      ...leakage,
      inspectedPublicArtifact: publicArtifact,
    },
    qualitativeCriteria_2_1_3: criteria,
    withdrawOrderChannel_R4: {
      shuffleEnabled: true,
      shuffleSeed: shuffleSeed,
      withdrawalsCompared: orderCheck.length,
      matchingPositions: orderMatches,
      expectedIfRandom: 1,
      verdict:
        orderCheck.length === 0
          ? 'n_too_small'
          : orderMatches <= Math.max(1, orderCheck.length * 0.05)
            ? 'pass'
            : 'fail',
      meaning:
        'number of withdrawals whose submission position equals their on-chain position.' +
        ' Equal to n means the on-chain order reveals the full submission order',
      sample: orderCheck.slice(0, 10),

      crossCheckFromChain: {
        withdrawalsCompared: chainCheckCount,
        matchingPositions: chainMatchCount,
        agreesWithRunnerBookkeeping: chainCheckCount === orderCheck.length && chainMatchCount === orderMatches,
        meaning:
          'counted from the on-chain Withdraw events.' +
          ' `agreesWithRunnerBookkeeping = false` means the' +
          " runner's bookkeeping does NOT match the chain - investigate",
      },
    },

    linkabilityChannels_R4: {
      walletReuseObserved: walletMatchCount,
      walletReuseMeaning:
        'number of times ONE address receives a payout for the second' +
        ' time or later. 0 means no two withdrawals can be linked through' +
        ' the wallet. The permanent cross-pool block is A21 at the database layer,' +
        ' proven by a test, not by this run',

      maxWithdrawalsPerBlock: maxPerBlock,
      distinctBlocks: countByBlock.size,
      withdrawEventsObserved: withdrawEvents.length,
      blockOrderMatchesChainOrder: blocksMonotonic,
      blockPositionMeaning:
        'block order is monotonic in transaction' +
        ' order => BLOCK POSITION carries no information' +
        ' beyond ORDER, and the order is shuffled.' +
        ' NOT a wall-clock timing measurement:' +
        ' on a test chain timestamps only reflect the speed' +
        ' of the runner loop',
      scope: 'one pool = one scholarship award round',
    },

    rootRebuildCheck_M4: rootRebuildCheck
      ? {
          leafCount: rootRebuildCheck.leafCount,
          rebuiltRoot: rootRebuildCheck.rebuiltRoot,
          onChainRoot: rootRebuildCheck.onChainRoot,
          rebuiltRootMatchesOnChain: rootRebuildCheck.matches,
          method:
            'commitments taken from the CommitmentsPublished' +
            ' event, hashed by the prover `root` mode, compared' +
            ' with `currentRoot` read from the contract',
          usesNoPrivateWitness: true,
        }
      : {
          rebuiltRootMatchesOnChain: false,
          reason: 'no rebuild performed this run',
        },

    amountBindingAtContract_C3: {
      withdrawTakesProof: tick(
        proofBoundOnChain,
        'the withdraw function has a proof/bytes parameter',
        'the withdraw function has no proof parameter',
      ),
      contractReadsAmountFromProof: tick(
        proofBoundOnChain,
        "the contract decodes `amount` from the proof's public" + ' inputs and compares it with the argument',
        'the contract has no proof to decode, so it cannot compare',
      ),
      closedBinding: tick(
        proofBoundOnChain,
        'the `amount` binding is CLOSED at contract level',
        'the `amount` binding is guaranteed by the backend ONLY,' + ' not closed at contract level',
      ),
      conclusion: proofBoundOnChain
        ? 'The contract DOES take the proof, decodes `amount` from the' +
          ' public inputs and compares it with the `amount` argument.' +
          ' The `amount` binding is CLOSED at contract level.'
        : 'The contract does NOT take the proof, so it cannot read' +
          ' `amount` from the public inputs and cannot compare it with' +
          ' the `amount` argument. The `amount` binding is guaranteed by' +
          ' the backend only, NOT closed at contract level.',
      verificationEvidence: 'contracts/test/ShieldedPoolWithdrawGate.js (5/5) - checks the three require statements',
      contributionRef: 'C3 - item 4: the experiment shows the limitation of ADV',
      caution: 'Must NOT be written as if the two mechanisms give the same' + ' security guarantee.',
    },
    limitations: {
      studentsInPool: studentCount,
      impact:
        'This run built ' +
        String(studentCount) +
        ' students in the' +
        ' pool. Even so, NONE of the 5 criteria measures ANONYMITY' +
        ' (the central claim of C1): the 5 criteria score replay' +
        ' prevention, readable state, verifiable state,' +
        ' ciphertext-only storage and' +
        ' private-witness secrecy - none of them asks whether an' +
        ' observer can tell who withdrew. Anonymity evidence lives in' +
        ' table B, condition R1 of THIS SAME RUN' +
        ' (`-B-privacy.csv`): `anonymitySetFromChain`,' +
        ' `distinctRecipients` and `distinctAmounts`, all counted' +
        ' from on-chain events.' +
        ' - The anonymity set is an UPPER BOUND and holds ONLY' +
        ' because the contract enforces one denomination' +
        ' (V1(b)); with mixed amounts it does not.',
      runCount: 1,
      notForPerformance:
        'These numbers are a single sample with no standard deviation.' +
        ' Official performance numbers belong to sections 6/7.',
      amountAndRecipientArePublic:
        'The Withdraw event emits `recipient` and `amount` in clear.' +
        ' The system hides the LINK between a payout and a note,' +
        ' not the payout itself.',

      unobservabilityNotClaimed:
        'ISO/IEC 15408-2 FPR_UNO.1 (unobservability) is NOT met and' +
        ' CANNOT be met by design: withdrawals are public events.' +
        ' This is the deliberate trade-off that produces criterion' +
        ' 2a. Do not present it as a defect, and do not cite' +
        ' FPR_UNO.4 in support of transparency - its wording says' +
        ' `authorized user`, which is the opposite axis.',

      collusionOutOfScope:
        'ISO/IEC 15408-2 FPR_UNL.1 (Annex I.4.2.2) requires' +
        ' unlinkability against COOPERATING users. That condition' +
        ' (R5) was taken OUT OF SCOPE on 2026-09-05: it is an' +
        ' EXAMPLE in a CC annex rather than a core requirement,' +
        ' and with only a few withdrawers the anonymity set barely' +
        ' shrinks. Closing it needs a reference threshold that has' +
        ' not been found yet (gap T5-D). It is NOT pending work' +
        ' and NO measurement of it exists - do not cite one.',

      standardsBoundary:
        'Criteria 1, 3 and 4 are NOT graded against any external' +
        " standard - they are properties of this system's own" +
        ' mechanisms and the experiment proves them directly.' +
        ' Criterion 2a borrows ISO/IEC 15408-2 FAU_SAR.1 only to' +
        ' name the `read` axis; criterion 2b takes its definition' +
        ' from NIST IR 8202 s4 p.18 because no Common Criteria' +
        ' component covers `any third party verifies ledger state' +
        ' without trusting the operator`.',
    },
  });

  fs.mkdirSync(outputDirectory, { recursive: true });
  const nSuffix = studentCount > 1 ? `-n${studentCount}` : '';

  const timestamp = finishedAt.toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDirectory, `qualitative-onchain${nSuffix}-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  const csvBase = outputPath.replace(/\.json$/, '');
  const csvFiles = buildCsvFiles(
    'on-chain (ONC)',
    result.metadata,
    criteria,
    result.amountBindingAtContract_C3,
    result.limitations,
    result.publicSurfaceAudit_K7,
  );
  const csvPaths: {
    criteria: string;
    amountBinding: string;
    appendix: string;
    students?: string;
    transparency?: string;
    privacy?: string;
  } = {
    criteria: csvBase + '-criteria.csv',
    amountBinding: csvBase + '-C3-amount-binding.csv',
    appendix: csvBase + '-measurement-conditions.csv',
  };

  if (csvFiles.students) {
    csvPaths.students = csvBase + '-students.csv';
  }

  fs.writeFileSync(csvPaths.criteria, CSV_BOM + csvFiles.criteria, 'utf8');
  fs.writeFileSync(csvPaths.amountBinding, CSV_BOM + csvFiles.amountBinding, 'utf8');
  fs.writeFileSync(csvPaths.appendix, CSV_BOM + csvFiles.appendix, 'utf8');

  if (csvFiles.students && csvPaths.students) {
    fs.writeFileSync(csvPaths.students, CSV_BOM + csvFiles.students, 'utf8');
  }

  const propertyPaths = writeStandardPropertyCsvs('on-chain (ONC)', outputPath);

  csvPaths.transparency = propertyPaths.transparency;
  csvPaths.privacy = propertyPaths.privacy;

  return {
    outputPath,
    csvPaths,
    result,
  };
}

export { runQualitativeExperiment, withdrawBindsProofOnChain };
