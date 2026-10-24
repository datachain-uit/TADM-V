import fs from 'fs';
import path from 'path';
import { Web3 } from 'web3';
import { HDNodeWallet } from 'ethers';
import { performance } from 'perf_hooks';
import { createStudentNote, derivePublicKeyFromPrivateKey } from '../clients/ipfs/noteEncryption';
import { uploadToIpfs } from '../clients/ipfs/encryptedNoteStorage';

async function createExperimentStudentRecord(
  studentIndex: number,
  studentId: number,
  amount: number,
  privateKey: string,
  address: string,
) {
  const publicKey = derivePublicKeyFromPrivateKey(privateKey);

  const note = createStudentNote(studentId, String(amount));

  note.amount = amount as unknown as string;

  const cid = await uploadToIpfs(note, publicKey);

  return {
    student_index: studentIndex,
    address,
    student_id: studentId,
    amount,
    private_key: privateKey,
    public_key: publicKey,
    cid,
    note,
  };
}

const web3 = new Web3('http://127.0.0.1:8545');

const GANACHE_MNEMONIC = process.env.GANACHE_MNEMONIC || 'test test test test test test test test test test test junk';

const STUDENT_ACCOUNT_OFFSET = 1;

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const DATA_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');

fs.mkdirSync(DATA_DIR, {
  recursive: true,
});

const SCENARIOS = [1, 10, 30, 60, 100, 500];

const MERKLE_DEPTH = 9;

const SCHOLARSHIP_AMOUNT = 2;

function getGanacheWalletByIndex(index: number) {
  const derivationPath = `m/44'/60'/0'/0/${index}`;

  const wallet = HDNodeWallet.fromPhrase(GANACHE_MNEMONIC, undefined, derivationPath);

  return {
    index,
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

async function assertGanacheAccountMatches(accountIndex: number, derivedAddress: string) {
  const accounts = await web3.eth.getAccounts();

  const ganacheAddress = accounts[accountIndex];

  if (!ganacheAddress) {
    throw new Error(`Ganache account index ${accountIndex} not found. Start Ganache with --wallet.totalAccounts 501`);
  }

  if (ganacheAddress.toLowerCase() !== derivedAddress.toLowerCase()) {
    throw new Error(
      [
        'Ganache account does not match derived mnemonic wallet.',
        `accountIndex=${accountIndex}`,
        `ganacheAddress=${ganacheAddress}`,
        `derivedAddress=${derivedAddress}`,
        'Make sure Ganache is started with the same mnemonic:',
        GANACHE_MNEMONIC,
      ].join('\n'),
    );
  }
}

async function prepareScenario(n: number) {
  const outputPath = path.resolve(DATA_DIR, `dataset_n${n}.json`);

  if (fs.existsSync(outputPath)) {
    console.log(
      `\nSKIP n = ${n} — dataset already exists: ${outputPath}` +
        '\n  (delete the file by hand if you really want to regenerate it;' +
        " then copy it to the other repo to keep the 'same input' claim)",
    );
    return;
  }

  console.log(`\nPreparing experiment dataset n = ${n}`);

  const students = [];

  for (let i = 0; i < n; i++) {
    const studentId = 24560000 + i;

    const ganacheAccountIndex = STUDENT_ACCOUNT_OFFSET + i;

    const ganacheWallet = getGanacheWalletByIndex(ganacheAccountIndex);

    await assertGanacheAccountMatches(ganacheAccountIndex, ganacheWallet.address);

    const tPrepare = performance.now();

    const studentRecord = await createExperimentStudentRecord(
      i,
      studentId,
      SCHOLARSHIP_AMOUNT,
      ganacheWallet.privateKey,
      ganacheWallet.address,
    );

    const preparationMs = performance.now() - tPrepare;

    students.push({
      ...studentRecord,
      ganache_account_index: ganacheAccountIndex,
      preparation_ms: preparationMs,
    });

    console.log(
      [
        `student_index=${i}`,
        `ganache_account=${ganacheAccountIndex}`,
        `address=${ganacheWallet.address}`,
        `student_id=${studentId}`,
        `preparation_ms=${preparationMs.toFixed(3)}`,
        `cid=${studentRecord.cid}`,
      ].join(', '),
    );
  }

  const dataset = {
    n,
    merkle_depth: MERKLE_DEPTH,
    school_account_index: 0,
    student_account_offset: STUDENT_ACCOUNT_OFFSET,
    students,
  };

  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2));

  console.log(`Saved: ${outputPath}`);
}

async function main() {
  for (const n of SCENARIOS) {
    await prepareScenario(n);
  }

  console.log('\nAll experiment datasets prepared.');
}

main().catch((error: any) => {
  console.error(error);
  process.exit(1);
});
