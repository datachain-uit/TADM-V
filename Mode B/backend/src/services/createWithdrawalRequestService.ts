const fs = require("fs");
const { StudentScholarship } = require("../models/StudentScholarship");
const { WithdrawalRequest } = require("../models/WithdrawalRequest");
require("../models/ScholarshipPool");
require("../models/UniversityStudent");
const { getContract, getPool, getWeb3, requireUnlockedAccount, sameAddress } = require("../clients/blockchain/blockchainClient");
const { computeCommitment, computeNullifier, generateStudentFile, normalizeBytes32 } = require("./generateStudentFile");
const { layDuongMerkle } = require("../repositories/merkleNodeRepository");

type StudentNote = { student_id: number; amount: string; rho: string };
type NoteSubmission = { cid: string; note: StudentNote };

/*
 * Gas cấp cho lời gọi Halo2Verifier.
 *
 * Đo thật: verify một proof depth 7 tốn ~442 800 gas. Để dư
 * rộng vì gas verify phụ thuộc kích thước circuit — đổi K hoặc
 * MERKLE_DEPTH là con số này đổi theo.
 *
 * Không truyền gas thì Ganache áp mặc định thấp hơn và báo
 * "out of gas" — trông giống proof sai, dễ chẩn đoán nhầm.
 */
const VERIFIER_CALL_GAS = 3_000_000;

function validateSubmission(value: any): NoteSubmission {
    if (typeof value?.cid !== "string" || value.cid.length === 0) throw new Error("Input must contain cid and note");
    const note = value.note;
    if (!Number.isSafeInteger(note?.student_id) || note.student_id <= 0) throw new Error("Invalid note student_id");
    if (!/^\d+$/.test(note?.amount) || BigInt(note.amount) <= 0n) throw new Error("Invalid note amount");
    if (!/^\d+$/.test(note?.rho) || BigInt(note.rho) <= 0n) throw new Error("Invalid note rho");
    return { cid: value.cid, note: { student_id: note.student_id, amount: note.amount, rho: note.rho } };
}

async function createWithdrawalRequest(submissionInput: NoteSubmission) {
    const { cid, note } = validateSubmission(submissionInput);
    const scholarship = await StudentScholarship.findOne({ encryptedNoteCid: cid })
        .populate("universityStudent")
        .populate("pool");
    if (!scholarship) throw new Error("Scholarship record not found for CID");
    const student = scholarship.universityStudent as any;
    const pool = scholarship.pool as any;
    if (!student || !pool || pool.status !== "DEPLOYED") throw new Error("Scholarship pool/student data is incomplete");
    if (scholarship.status !== "ROOT_APPROVED") {
        throw new Error("Scholarship status must be ROOT_APPROVED");
    }
    if (student.studentId !== note.student_id || student.amountWei !== note.amount) {
        throw new Error("Decrypted note does not match the approved student/Finance amount");
    }
    if (!pool.contractAddress || !pool.verifierAddress || !pool.chainId) {
        throw new Error("Pool contract/verifier is not ready");
    }
    const activeRequest = await WithdrawalRequest.exists({
        scholarship: scholarship._id,
        status: { $in: ["PENDING_APPROVAL", "EXECUTION_FAILED"] },
    });
    if (activeRequest) throw new Error("An active withdrawal request already exists");

    const commitment = computeCommitment(note);
    if (commitment.toLowerCase() !== scholarship.commitment.toLowerCase()) {
        throw new Error("Decrypted note does not match stored commitment");
    }
    const nullifier = computeNullifier(note);
    const contract = getPool(pool.contractAddress);
    const currentRoot = String(await contract.methods.currentRoot().call());
    const [validRoot, usedNullifier, chainVerifier] = await Promise.all([
        contract.methods.validRoot(currentRoot).call(),
        contract.methods.usedNullifier(nullifier).call(),
        contract.methods.verifier().call(),
    ]);
    if (/^0x0{64}$/i.test(currentRoot) || validRoot !== true) {
        throw new Error("Current root is empty or not valid on-chain");
    }
    if (usedNullifier === true) throw new Error("Nullifier was already used");
    if (!sameAddress(String(chainVerifier), pool.verifierAddress)) throw new Error("Unexpected verifier contract");

    const approved = await StudentScholarship.find({
        pool: pool._id,
        commitment: { $exists: true },
        status: { $in: ["ROOT_APPROVED", "WITHDRAWAL_REQUESTED", "WITHDRAWN"] },
    }).sort({ merkleIndex: 1 });
    approved.forEach((item: any, index: number) => {
        if (item.merkleIndex !== index) throw new Error("Approved Merkle indexes are not contiguous");
    });
    const itemAtIndex = approved[Number(scholarship.merkleIndex)];
    if (!itemAtIndex || String(itemAtIndex._id) !== String(scholarship._id)) {
        throw new Error("Scholarship does not match its stored Merkle index");
    }
    const commitments = approved.map((item: any) => item.commitment);
    /*
     * K10 — 03/09/2026: doc duong Merkle da luu san.
     *
     * Co thi prover khong dung lai cay (O(depth) thay vi O(n x depth)).
     * Khong co — pool duyet root truoc K10, hoac prover cu khong tra ve
     * nodes — thi `layDuongMerkle` tra ve null va ta giu nguyen duong cu
     * bang commitments. Khong bao loi: du lieu cu phai rut duoc.
     */
    const duongDaLuu = await layDuongMerkle(
        pool._id,
        Number(scholarship.merkleIndex),
        Number(pool.merkleDepth) || 0,
        (pool.merkleZeros as string[]) || [],
    );
    console.error(
        duongDaLuu
            ? `MERKLE PATH: read ${duongDaLuu.siblings.length} stored nodes`
            : `MERKLE PATH: not stored - rebuilding from ${commitments.length} commitments`,
    );
    const generated = generateStudentFile(
        note,
        commitments,
        scholarship.merkleIndex,
        currentRoot,
        // A25 — vi nhan = vi sinh vien da dang ky; proof gan voi vi nay.
        scholarship.walletAddress,
        duongDaLuu,
    );
    /*
     * ===== CỔNG CHẶN CHÍNH — chạy TRƯỚC mọi kiểm tra JS =====
     *
     * Verify proof bằng Halo2Verifier THẬT, với ba public input
     * nạp từ nguồn ĐỘC LẬP với prover.
     *
     * 128 byte đầu của calldata chính là [root | nullifier | amount | recipient].
     * Nếu gửi nguyên calldata do prover sinh ra thì verifier chỉ hỏi
     * "proof có khớp lời khai của chính nó không" - luôn khớp, không
     * chặn được gì. Nên thay 128 byte đó bằng:
     *
     *   root      <- currentRoot đọc từ smart contract
     *   nullifier <- backend tự tính từ rho trong note
     *   amount    <- số tiền Phòng KH-TC đã duyệt
     *   recipient <- ví sinh viên đã đăng ký (A25)
     *
     * Phần proof giữ nguyên. Note đúng thì bốn giá trị này trùng khớp
     * với calldata gốc nên không đổi gì; note giả thì verifier TỪ CHỐI.
     *
     * Đối xứng với mode `verify` của repo off-chain.
     * Xem code/VERIFY_MECHANISM.md và code/CONSTRAINT_FLOW.md mục 7b.
     */
    getContract("Halo2Verifier", pool.verifierAddress);

    const asWord = (value: string) =>
        BigInt(value).toString(16).padStart(64, "0");

    const trustedCalldata =
        "0x"
        + asWord(currentRoot)          // từ smart contract
        + asWord(nullifier)            // backend tự tính từ rho
        + asWord(student.amountWei)    // số Phòng KH-TC đã duyệt
        + asWord(scholarship.walletAddress) // A25 — ví sinh viên đã đăng ký
        + String(generated.calldata).replace(/^0x/, "").slice(256);

    /*
     * ===== GIAI DOAN 1 — XAC MINH VA GHI NHAN LEN CHUOI =====
     *
     * DOI 2026-08-25: truoc day day la `eth.call` — mo phong, MIEN PHI,
     * nhung KHONG DE LAI DAU VET tren chuoi. Hop dong o buoc rut khong
     * co cach nao biet no da xay ra, nen phai verify LAI.
     *
     * Nay goi `verifyAndRecord` bang GIAO DICH THAT. Hop dong tu verify
     * roi GHI ket qua vao `claims[nullifier]`. Sau buoc nay:
     *
     *   - yeu cau "pending" moi dung nghia: DA duoc chung minh, cho duyet
     *   - Phong KH-TC chi con DUYET (`settle`), khong phai kiem lai
     *   - chi phi xac minh tro thanh MOT GIAO DICH RIENG, do thang duoc
     *
     * A25 (2026-09-12) — `verifyAndRecord` la onlySchool, va vi nhan la
     * public input thu 4. Truoc A25 ham nay de mo, trong khi proof khong
     * gan voi vi nhan: ke doc mempool chep proof, gui truoc voi vi cua
     * han, va Claim ghi SAI vi — tien sinh vien ket vinh vien. Nay chi vi
     * truong ghi duoc Claim, va vi nhan phai trung word thu 4 cua proof.
     * Hop dong van TU xac thuc proof — onlySchool chi quy dinh ai nop.
     */
    const sender = await requireUnlockedAccount(
        String(await contract.methods.school().call())
    );

    let verifyReceipt: any = null;

    try {
        /*
         * PHẢI truyền gas tường minh.
         *
         * Halo2Verifier tốn ~442 800 gas, cộng chi phí ghi `Claim`.
         * Không truyền thì Ganache áp mặc định thấp hơn -> "out of
         * gas", trông giống proof sai nhưng thực ra là thiếu gas.
         */
        verifyReceipt = await contract.methods
            .verifyAndRecord(
                trustedCalldata,
                normalizeBytes32(currentRoot),
                normalizeBytes32(nullifier),
                scholarship.walletAddress,
                String(student.amountWei)
            )
            .send({
                from: sender,
                gas: VERIFIER_CALL_GAS
            });
    } catch (verifyError) {
        /*
         * Halo2Verifier đã TỪ CHỐI — quyết định đã xong ở đây.
         *
         * Ba phép so bên dưới KHÔNG quyết định gì; chúng chỉ giải
         * thích số nào lệch. Cần thiết vì verifier kiểm cả ba public
         * input bằng MỘT phép kiểm mật mã, nên chỉ trả về đúng/sai
         * chứ không tách được số nào sai.
         */
        if (generated.root.toLowerCase() !== currentRoot.toLowerCase()) {
            throw new Error("Proof rejected by Halo2Verifier: root does not match currentRoot on-chain");
        }
        if (generated.nullifier.toLowerCase() !== nullifier.toLowerCase()) {
            throw new Error("Proof rejected by Halo2Verifier: nullifier does not match the value computed by backend");
        }
        if (BigInt(generated.amount) !== BigInt(student.amountWei)) {
            throw new Error("Proof rejected by Halo2Verifier: amount does not match the Finance-approved amount");
        }
        if (BigInt(generated.recipient) !== BigInt(scholarship.walletAddress)) {
            throw new Error("Proof rejected by Halo2Verifier: recipient does not match the registered student wallet");
        }
        throw verifyError;
    }

    const request = await WithdrawalRequest.create({
        pool: pool._id,
        scholarship: scholarship._id,
        poolContractAddress: pool.contractAddress,
        poolChainId: pool.chainId,
        proof: generated.proof,
        calldata: generated.calldata,
        expectedRoot: generated.root,
        expectedNullifier: generated.nullifier,
        amountWei: note.amount,
        recipient: scholarship.walletAddress,
        localVerificationPassed: true,
        status: "PENDING_APPROVAL",
        proofPreparedAt: new Date(),

        /*
         * Bang chung GIAI DOAN 1 nam TREN CHUOI, khong phai co trong DB.
         * Ai cung mo giao dich nay ra kiem duoc: no chua staticcall toi
         * Halo2Verifier va ghi `claims[nullifier]`.
         */
        verifyRecordTxHash: verifyReceipt
            ? String(verifyReceipt.transactionHash)
            : undefined,
        verifyRecordGas: verifyReceipt
            ? Number(verifyReceipt.gasUsed)
            : undefined,
    });
    scholarship.status = "WITHDRAWAL_REQUESTED";
    await scholarship.save();
    return {
        id: request.id,
        scholarshipId: scholarship.id,
        poolId: pool.id,
        recipient: request.recipient,
        amountWei: request.amountWei,
        root: request.expectedRoot,
        nullifier: request.expectedNullifier,
        status: request.status,
        verifierChecked: request.localVerificationPassed,
        verifyRecordTxHash: request.verifyRecordTxHash,
        verifyRecordGas: request.verifyRecordGas,
        calldataBytes: (request.calldata.length - 2) / 2,
        createdAt: request.createdAt,
    };
}



module.exports = { createWithdrawalRequest, validateSubmission };

if (require.main === module) {
    require("../cli/createWithdrawalRequestCli")
        .runCreateWithdrawalRequestCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
