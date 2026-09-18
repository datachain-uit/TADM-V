require("dotenv").config({ quiet: true });

const { withDatabaseCleanup } = require("../controllers/databaseController");
const { printJson } = require("../utils/serviceOutput");
const { approveEligibility } = require("./approveEligibilityService");
const { approveFinance } = require("./approveFinanceService");
const { approveRoot } = require("./approveRootService");
const { createScholarshipPool } = require("./createScholarshipPoolService");
const { createStudentProfile } = require("./createStudentProfileService");
const { createUniversity } = require("./createUniversityService");
const { seedDefaultStaff } = require("./createUniversityStaffService");
const { createWithdrawalRequest } = require("./createWithdrawalRequestService");
const { deployScholarshipPool } = require("./deployScholarshipPoolService");
const { fundScholarshipPool } = require("./fundScholarshipPoolService");
const { getPool, getWeb3 } = require("../clients/blockchain/blockchainClient");
const { getScholarshipPoolBalance } = require("./getScholarshipPoolBalanceService");
const { derivePublicKeyFromPrivateKey } = require("../clients/ipfs/ipfsClient");
const { decryptStudentNote } = require("../clients/ipfs/noteEncryption");
const { issueScholarship } = require("./issueScholarshipService");
const { registerStudentWallet } = require("./registerStudentWalletService");
const { reviewWithdrawalRequest } = require("./reviewWithdrawalRequestService");

function progress(step: number, message: string) {
    process.stderr.write(`[${step}/13] ${message}\n`);
}

async function runFullFlow() {
    const web3 = getWeb3();
    const accounts: string[] = await web3.eth.getAccounts();
    if (accounts.length < 3 || !accounts[0] || !accounts[1] || !accounts[2]) {
        throw new Error("RPC must expose at least university, sponsor and student accounts");
    }
    const universityWallet = accounts[0];
    const sponsorWallet = accounts[1];
    const studentWallet = accounts[2];
    const runTag = Date.now().toString();
    const studentId = Number(process.env.STUDENT_ID || runTag.slice(-8));
    const email = process.env.STUDENT_EMAIL || `student-${runTag}@example.edu`;
    const amountWei = process.env.SCHOLARSHIP_AMOUNT_WEI || web3.utils.toWei("0.1", "ether");
    const initialFundingWei = process.env.INITIAL_POOL_FUNDING_WEI || web3.utils.toWei("1", "ether");
    const sponsorAmountWei = process.env.SPONSOR_AMOUNT_WEI || web3.utils.toWei("0.5", "ether");
    const notePrivateKey = process.env.STUDENT_NOTE_PRIVATE_KEY
        || "0x1c0de00000000000000000000000000000000000000000000000000000000001";

    const university = await createUniversity(`Demo University ${runTag}`, universityWallet);
    // K6 — dung san hai phong ban truoc khi duyet.
    const staff = await seedDefaultStaff(university.id);
    const student = await createStudentProfile(university.id, staff.STUDENT_AFFAIRS, studentId, email);
    progress(1, `Created University and PENDING student ${student.id}`);
    await approveEligibility(university.id, staff.STUDENT_AFFAIRS, studentId);
    await approveFinance(university.id, staff.FINANCE, studentId, amountWei);
    progress(2, "University approved eligibility, then Finance approved the budget");

    const pool = await createScholarshipPool(university.id, staff.FINANCE);
    progress(3, `Created pool record ${pool.id} with PENDING_DEPLOYMENT`);
    const deployedPool = await deployScholarshipPool(pool.id, staff.FINANCE, initialFundingWei);
    progress(4, `Deployed Halo2Verifier ${deployedPool.verifierAddress} and ShieldedPool ${deployedPool.contractAddress}`);
    const funding = await fundScholarshipPool(pool.id, staff.FINANCE, sponsorAmountWei, sponsorWallet);
    progress(5, `Sponsor funded pool; balance=${funding.balanceWei} wei`);

    const publicKey = derivePublicKeyFromPrivateKey(notePrivateKey);
    // A22 — them `pool.id`: mot truong co the co nhieu chuong trinh.
    await registerStudentWallet(university.id, staff.STUDENT_AFFAIRS, pool.id, email, studentWallet, publicKey);
    progress(6, "Registered student wallet and public encryption key (private key not stored)");
    const scholarship = await issueScholarship(university.id, staff.STUDENT_AFFAIRS, studentId);
    progress(7, `Assigned Merkle index, created commitment and encrypted note CID ${scholarship.encryptedNoteCid}`);
    const rootApproval = await approveRoot(pool.id, staff.STUDENT_AFFAIRS);
    progress(8, `University approved and published root ${rootApproval.root}`);

    const decryptedNote = await decryptStudentNote(scholarship.encryptedNoteCid, notePrivateKey);
    progress(9, "Student fetched and decrypted the IPFS note");
    const withdrawalRequest = await createWithdrawalRequest(decryptedNote);
    progress(10, `Generated Halo2 proof/calldata; verifier accepted it; request ${withdrawalRequest.id} is PENDING_APPROVAL`);

    const studentBalanceBefore = await web3.eth.getBalance(studentWallet);
    const executed = await reviewWithdrawalRequest(withdrawalRequest.id, staff.FINANCE, "approve");
    const studentBalanceAfter = await web3.eth.getBalance(studentWallet);
    progress(11, `University approved; contract withdrew in tx ${executed.transactionHash}`);
    if (BigInt(studentBalanceAfter) - BigInt(studentBalanceBefore) !== BigInt(amountWei)) {
        throw new Error("Student balance delta does not equal Finance-approved amount");
    }

    let replayError = "";
    try {
        await reviewWithdrawalRequest(withdrawalRequest.id, staff.FINANCE, "approve");
        throw new Error("Replay unexpectedly succeeded");
    } catch (error) {
        replayError = (error as Error).message;
    }
    const contract = getPool(deployedPool.contractAddress);
    const usedNullifier = Boolean(await contract.methods.usedNullifier(withdrawalRequest.nullifier).call());
    if (!usedNullifier || replayError === "Replay unexpectedly succeeded") throw new Error("Nullifier replay protection failed");
    progress(12, "Second approval was broadcast and reverted; usedNullifier remains true");
    const finalBalance = await getScholarshipPoolBalance(pool.id);
    progress(13, "All state, verifier, transfer and replay assertions passed");

    return {
        success: true,
        universityId: university.id,
        studentRecordId: student.id,
        poolId: pool.id,
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
    /*
     * Sau refactor, service khong tu mo ket noi nua. Full flow goi 13
     * service lien tiep nen mo MOT lan o day, dong MOT lan khi xong.
     */
    withDatabaseCleanup(runFullFlow)
        .then(printJson)
        .catch((error: Error) => {
            console.error(error);
            process.exitCode = 1;
        });
}

module.exports = { runFullFlow };
