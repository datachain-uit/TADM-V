import '../config/env';
import { withDatabase } from '../config/db';
import { printJson } from '../utils/serviceOutput';
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
import { readPoolBalance } from '../services/pool.service';
import { derivePublicKeyFromPrivateKey } from '../clients/ipfs/noteEncryption';
import { decryptStudentNote } from '../clients/ipfs/encryptedNoteStorage';
import { issueScholarship } from '../services/scholarship.service';
import { registerStudentWallet } from '../services/studentWallet.service';
import { reviewWithdrawalRequest } from '../services/withdrawalReview.service';

function progress(step: number, message: string) {
  process.stderr.write(`[${step}/13] ${message}\n`);
}

async function runFullFlow() {
  const web3 = getWeb3();
  const accounts: string[] = await web3.eth.getAccounts();
  if (accounts.length < 3 || !accounts[0] || !accounts[1] || !accounts[2]) {
    throw new Error('RPC must expose at least university, sponsor and student accounts');
  }
  const universityWallet = accounts[0];
  const sponsorWallet = accounts[1];
  const studentWallet = accounts[2];
  const runTag = Date.now().toString();
  const studentId = Number(process.env.STUDENT_ID || runTag.slice(-8));
  const email = process.env.STUDENT_EMAIL || `student-${runTag}@example.edu`;
  const amountWei = process.env.SCHOLARSHIP_AMOUNT_WEI || web3.utils.toWei('0.1', 'ether');
  const initialFundingWei = process.env.INITIAL_POOL_FUNDING_WEI || web3.utils.toWei('1', 'ether');
  const sponsorAmountWei = process.env.SPONSOR_AMOUNT_WEI || web3.utils.toWei('0.5', 'ether');
  const notePrivateKey =
    process.env.STUDENT_NOTE_PRIVATE_KEY || '0x1c0de00000000000000000000000000000000000000000000000000000000001';

  const university = await createUniversity(`Demo University ${runTag}`, universityWallet);
  const staff = await seedDefaultStaff(university.universityId);
  const student = await createStudentProfile(university.universityId, staff.STUDENT_AFFAIRS, studentId, email);
  progress(1, `Created University and PENDING student ${student.studentId}`);
  await approveEligibility(university.universityId, staff.STUDENT_AFFAIRS, studentId, 'approve');
  await approveFinance(university.universityId, staff.FINANCE, studentId, amountWei);
  progress(2, 'University approved eligibility, then Finance approved the budget');

  const pool = await createScholarshipPool(university.universityId, staff.FINANCE);
  progress(3, `Created pool record ${pool.poolId} with PENDING_DEPLOYMENT`);
  const deployedPool = await deployScholarshipPool(pool.poolId, staff.FINANCE, initialFundingWei);
  progress(
    4,
    `Deployed Halo2Verifier ${deployedPool.verifierAddress} and ShieldedPool ${deployedPool.contractAddress}`,
  );
  const funding = await fundPool(pool.poolId, staff.FINANCE, sponsorAmountWei, sponsorWallet);
  progress(5, `Sponsor funded pool; balance=${funding.balanceWei} wei`);

  const publicKey = derivePublicKeyFromPrivateKey(notePrivateKey);

  await registerStudentWallet(
    university.universityId,
    staff.STUDENT_AFFAIRS,
    pool.poolId,
    email,
    studentWallet,
    publicKey,
  );
  progress(6, 'Registered student wallet and public encryption key (private key not stored)');
  const scholarship = await issueScholarship(university.universityId, staff.STUDENT_AFFAIRS, studentId);
  progress(7, `Assigned Merkle index, created commitment and encrypted note CID ${scholarship.encryptedNoteCid}`);
  const rootApproval = await approveRoot(pool.poolId, staff.STUDENT_AFFAIRS);
  progress(8, `University approved and published root ${rootApproval.root}`);

  const decryptedNote = await decryptStudentNote(scholarship.encryptedNoteCid, notePrivateKey);
  progress(9, 'Student fetched and decrypted the IPFS note');

  const withdrawalRequest = await createWithdrawalRequest(decryptedNote);
  progress(
    10,
    `Generated Halo2 proof/calldata; verifier accepted it; request ${withdrawalRequest.id} is PENDING_APPROVAL`,
  );

  const studentBalanceBefore = await web3.eth.getBalance(studentWallet);
  const executed = await reviewWithdrawalRequest(withdrawalRequest.id, staff.FINANCE, 'approve');
  const studentBalanceAfter = await web3.eth.getBalance(studentWallet);
  progress(11, `University approved; contract withdrew in tx ${executed.transactionHash}`);
  if (BigInt(studentBalanceAfter) - BigInt(studentBalanceBefore) !== BigInt(amountWei)) {
    throw new Error('Student balance delta does not equal Finance-approved amount');
  }

  let replayError = '';
  try {
    await reviewWithdrawalRequest(withdrawalRequest.id, staff.FINANCE, 'approve');
    throw new Error('Replay unexpectedly succeeded');
  } catch (error) {
    replayError = (error as Error).message;
  }
  const contract = getPool(deployedPool.contractAddress);
  const usedNullifier = Boolean(await contract.methods.usedNullifier(withdrawalRequest.nullifier).call());
  if (!usedNullifier || replayError === 'Replay unexpectedly succeeded')
    throw new Error('Nullifier replay protection failed');
  progress(12, 'Second approval was broadcast and reverted; usedNullifier remains true');
  const finalBalance = await readPoolBalance(pool.poolId);
  progress(13, 'All state, verifier, transfer and replay assertions passed');

  return {
    success: true,
    universityId: university.universityId,
    studentId: student.studentId,
    poolId: pool.poolId,
    verifierAddress: deployedPool.verifierAddress,
    poolAddress: deployedPool.contractAddress,
    cid: scholarship.encryptedNoteCid,
    commitment: scholarship.commitment,
    nullifier: withdrawalRequest.nullifier,
    root: rootApproval.root,
    withdrawalRequestId: withdrawalRequest.id,
    withdrawalTransactionHash: executed.transactionHash,
    studentBalanceDeltaWei: (BigInt(studentBalanceAfter) - BigInt(studentBalanceBefore)).toString(),
    poolBalanceAfterWei: finalBalance.balanceWei,
    usedNullifier,
    replayRejected: true,
    replayError,
  };
}

if (require.main === module) {
  withDatabase(runFullFlow)
    .then(printJson)
    .catch((error: Error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { runFullFlow };
