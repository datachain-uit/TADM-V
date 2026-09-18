const { StudentScholarship } = require("../models/StudentScholarship");
const { University } = require("../models/University");
const { UniversityStudent } = require("../models/UniversityStudent");
const { WithdrawalRequest } = require("../models/WithdrawalRequest");
require("../models/ScholarshipPool");
const { getPool, getWeb3, requireUnlockedAccount, sameAddress } = require("../clients/blockchain/blockchainClient");

const { authorizeStaff, ROLE_LABEL } = require("./authorizeStaffService");

/* Buoc chi tien — thuoc Phong Ke hoach - Tai chinh (K6). */
async function reviewWithdrawalRequest(requestId: string, staffId: string, decision: string) {
    if (!["approve", "reject"].includes(decision)) throw new Error("Decision must be approve or reject");
    const request = await WithdrawalRequest.findById(requestId).populate("pool").populate("scholarship");
    if (!request) throw new Error("Withdrawal request not found");
    const pool = request.pool as any;

    // Kiem vai tro SAU khi co pool, vi chi pool moi biet truong nao.
    const staff = await authorizeStaff(String(pool.university), staffId, "FINANCE");
    console.log("duyet boi:", staff.staffId, "-", ROLE_LABEL[staff.role]);
    const scholarship = request.scholarship as any;

    if (decision === "reject") {
        if (request.status !== "PENDING_APPROVAL") throw new Error("Only a pending request can be rejected");
        request.status = "REJECTED";
        request.reviewedAt = new Date();
        scholarship.status = "ROOT_APPROVED";
        await request.save();
        await scholarship.save();
        return { id: request.id, status: request.status, reviewedAt: request.reviewedAt };
    }
    if (!["PENDING_APPROVAL", "EXECUTION_FAILED", "EXECUTED"].includes(request.status)) {
        throw new Error("Request is not approvable");
    }
    const student = await UniversityStudent.findById(scholarship.universityStudent);
    const university = await University.findById(student?.university);
    if (!student || !university) throw new Error("Student/University not found");
    if (request.amountWei !== scholarship.amountWei || request.amountWei !== student.amountWei) {
        throw new Error("Withdrawal amount differs from Finance approval");
    }
    if (!sameAddress(request.recipient, scholarship.walletAddress)) {
        throw new Error("Withdrawal recipient differs from registered student wallet");
    }
    // Root chỉ được kiểm tra bằng currentRoot/validRoot đọc từ smart contract bên dưới.
    // pool.currentRoot trong MongoDB là bản sao phục vụ audit, không phải nguồn quyết định.
    if (!request.localVerificationPassed) throw new Error("Proof was not verified before University review");

    /*
     * Vi KY GIAO DICH cua pool nay. `pool.operatorAddress` de trong thi
     * roi ve vi truong => hanh vi Y NHU TRUOC 2026-09-01.
     *
     * Cho phep MOI CHUONG TRINH mot vi rieng => chuoi nonce rieng => cac
     * chuong trinh cua cung mot truong khong phai cho nhau khi chi tien.
     *
     * ⚠️ Phan quyen KHONG doi: `authorizeStaff(..., "FINANCE")` o tren van
     * chay truoc, va no kiem NGUOI duyet chu khong kiem vi ky.
     */
    const operatorAddress =
        pool.operatorAddress || university.walletAddress;

    const universityWallet = await requireUnlockedAccount(operatorAddress);
    const contract = getPool(pool.contractAddress);
    const [school, verifier, validRoot, usedBefore, balanceBefore] = await Promise.all([
        contract.methods.school().call(),
        contract.methods.verifier().call(),
        contract.methods.validRoot(request.expectedRoot).call(),
        contract.methods.usedNullifier(request.expectedNullifier).call(),
        getWeb3().eth.getBalance(pool.contractAddress),
    ]);
    if (!sameAddress(String(school), universityWallet)) throw new Error("Reviewer is not the on-chain school");
    if (!sameAddress(String(verifier), pool.verifierAddress)) throw new Error("Unexpected verifier contract");
    /*
     * D1 — KHÔNG bắt root phải bằng currentRoot.
     *
     * Proof vẫn dùng được nếu root của nó còn nằm trong
     * validRoot history trên contract. Bắt bằng currentRoot
     * sẽ từ chối oan: giữa lúc tạo request và lúc duyệt, nếu
     * có sinh viên khác được cấp học bổng thì updateRoot chạy
     * và currentRoot đổi, trong khi proof cũ vẫn hợp lệ với
     * root cũ.
     *
     * Điều kiện quyết định nằm ở contract: ShieldedPool.withdraw
     * có require(validRoot[root], "root not in history").
     *
     * Đối xứng với repo off-chain — xem code/STATUS.md mục D1.
     */
    if (validRoot !== true) {
        throw new Error("The proof root is not in validRoot history");
    }
    /*
     * A25 — lop chan (c): doc lai Claim TREN CHUOI truoc khi chi.
     *
     * `settle` chi theo Claim da ghi, khong nhan tham so nao khac. Nen
     * truoc khi goi, kiem chinh Claim do: da xac minh, ghi DUNG vi da
     * dang ky, DUNG so tien Phong KH-TC da duyet. Khong tin ban sao
     * trong MongoDB — cai quyet dinh tien di dau la ban ghi tren chuoi.
     */
    const claim: any = await contract.methods.claims(request.expectedNullifier).call();
    if (claim.verified !== true) {
        throw new Error("No verified on-chain claim for this nullifier");
    }
    if (!sameAddress(String(claim.recipient), scholarship.walletAddress)) {
        throw new Error("On-chain claim recipient differs from registered student wallet");
    }
    if (BigInt(claim.amount) !== BigInt(request.amountWei)) {
        throw new Error("On-chain claim amount differs from Finance approval");
    }
    if (request.status !== "EXECUTED" && BigInt(balanceBefore) < BigInt(request.amountWei)) {
        throw new Error("Insufficient pool balance");
    }

    /*
     * ===== GIAI DOAN 2 — DUYET VA CHI =====
     *
     * DOI 2026-08-25: truoc day goi `withdraw(...)` — gop xac minh va
     * thanh toan vao mot giao dich. Nay goi `settle(nullifier)`.
     *
     * VI SAO DOI:
     * Xac minh la hanh vi CHUNG MINH, da xong o giai doan 1 va da ghi
     * len chuoi (`claims[nullifier]`). Phong KH-TC chi con DUYET va CHI
     * — dung phan vai nghiep vu.
     *
     * 🔴 `settle` CHI NHAN `nullifier`. Moi gia tri khac (root, amount,
     *    recipient) hop dong DOC TU `Claim` da ghi, khong nhan tham so
     *    moi. Do la thu chan kich ban "verify chung minh mot dang,
     *    thanh toan chi mot neo" — xem contracts/test/ClaimBinding.js.
     *
     * `withdraw(...)` van con trong hop dong, dung de do THIET KE GOP
     * trong thuc nghiem dinh luong. Luong nghiep vu that dung `settle`.
     */
    const method = contract.methods.settle(
        request.expectedNullifier
    );
    const gas = request.status === "EXECUTED"
        ? Number(request.gasLimit || 5_000_000)
        : Math.ceil(Number(await method.estimateGas({ from: universityWallet })) * 1.2);
    let receipt: any;
    try {
        receipt = await method.send({ from: universityWallet, gas });
    } catch (error) {
        if (request.status !== "EXECUTED") {
            request.status = "EXECUTION_FAILED";
            request.failureReason = (error as Error).message;
            request.reviewedAt = new Date();
            await request.save();
        }
        throw error;
    }
    const [usedAfter, balanceAfter] = await Promise.all([
        contract.methods.usedNullifier(request.expectedNullifier).call(),
        getWeb3().eth.getBalance(pool.contractAddress),
    ]);
    if (usedBefore === true || usedAfter !== true) throw new Error("Unexpected nullifier state after withdrawal");
    request.status = "EXECUTED";
    request.transactionHash = String(receipt.transactionHash);
    request.gasLimit = gas;
    /* Chi phi GIAI DOAN 2 — so truc tiep voi withdrawOffChain cua nhanh off-chain. */
    request.settleGas = Number(receipt.gasUsed);
    request.reviewedAt = new Date();
    request.failureReason = undefined;
    scholarship.status = "WITHDRAWN";
    scholarship.withdrawTxHash = String(receipt.transactionHash);
    await request.save();
    await scholarship.save();
    return {
        id: request.id,
        status: request.status,
        recipient: request.recipient,
        amountWei: request.amountWei,
        nullifier: request.expectedNullifier,
        transactionHash: request.transactionHash,
        settleGas: request.settleGas,
        usedNullifier: Boolean(usedAfter),
        poolBalanceBeforeWei: String(balanceBefore),
        poolBalanceAfterWei: String(balanceAfter),
    };
}



/*
 * ===== DUYET THEO LO — XAO TRON THU TU CHI TIEN =====
 * Them 2026-09-01.
 *
 * VI SAO CO HAM NAY.
 *
 * `anonymityExperiment.ts` do "kenh thu tu" (duong tan cong 4): ke quan
 * sat biet THU TU NOP DON, roi doan "lan rut thu i tren chuoi la nguoi
 * nop thu i". Kenh nay ton tai vi `onlySchool` buoc moi lenh rut di qua
 * MOT tai khoan => MOT chuoi nonce => EVM xu ly dung thu tu gui.
 *
 * 🔴 LO HONG DA PHAT HIEN 2026-09-01: bien phap chong duy nhat —
 * "truong XAO TRON truoc khi giai ngan" — CHI TON TAI TRONG FILE THI
 * NGHIEM (`scenario.shuffleWithdrawOrder`). Luong that KHONG he xao:
 * `reviewWithdrawalRequest` nhan DUNG MOT `requestId`, nen no khong co
 * khai niem thu tu de ma xao. Can bo mo danh sach cho roi bam tu tren
 * xuong => thu tu tren chuoi = thu tu nop don => KENH MO TOANG.
 *
 * => Ket qua an danh dang dua tren mot bien phap ma code san pham khong
 *    thuc hien. Ham nay bien no thanh CO CHE THAT.
 *
 * NHUNG GI GIU NGUYEN:
 *   - Phan quyen: moi don van di qua `reviewWithdrawalRequest`, van goi
 *     `authorizeStaff(..., "FINANCE")`. Khong noi long mot rang buoc nao.
 *   - Hop dong: KHONG dung toi => gas KHONG doi.
 *   - Nha truong van giam sat: can bo van la nguoi quyet DUYET HAY KHONG.
 *     Thu tu CHI TIEN moi la thu do he thong quyet.
 *
 * 🔴 PHAI dung `crypto.randomInt`, KHONG dung `Math.random`. Ke tan cong
 * doan duoc hat giong la xao tron thanh vo nghia.
 *
 * 🔴 PHAI chay TUAN TU (`await` tung cai). Ca lo di chung MOT vi truong
 * => chung mot chuoi nonce; ban song song bang `Promise.all` se dung
 * nonce trung nhau va hong giao dich.
 *
 * ⚠️ GIOI HAN — day la BIEN PHAP VAN HANH, khong phai bao dam mat ma.
 * No dong kenh thu tu voi ke quan sat CHI NHIN CHUOI. Nguoi co quyen doc
 * MongoDB van thay `reviewedAt` cua tung don.
 */
function xaoTronThuTu<T>(danhSach: T[]): T[] {
    const crypto = require("crypto");
    const ketQua = danhSach.slice();

    // Fisher-Yates, nguon ngau nhien mat ma.
    // Destructuring thay vi bien tam: `noUncheckedIndexedAccess` coi
    // `ketQua[i]` la `T | undefined` nen gan qua bien tam se khong bien dich.
    for (let i = ketQua.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [ketQua[i], ketQua[j]] = [ketQua[j] as T, ketQua[i] as T];
    }

    return ketQua;
}

async function reviewWithdrawalBatch(
    requestIds: string[],
    staffId: string,
    decision: string
) {
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
        throw new Error("requestIds must be a non-empty array");
    }

    const trungLap =
        new Set(requestIds).size !== requestIds.length;

    if (trungLap) {
        throw new Error("requestIds contains duplicates");
    }

    const thuTuChi = xaoTronThuTu(requestIds);

    console.log(
        "duyet theo lo:", requestIds.length, "don"
        + " | thu tu chi tien DA XAO TRON (crypto.randomInt)"
    );

    const ketQua: any[] = [];
    const thatBai: any[] = [];

    for (const requestId of thuTuChi) {
        try {
            // Phan quyen FINANCE duoc kiem BEN TRONG ham nay, tung don.
            const r = await reviewWithdrawalRequest(
                requestId,
                staffId,
                decision
            );

            ketQua.push(r);
        } catch (error) {
            /*
             * Mot don hong KHONG duoc chan ca lo — neu dung lai thi cac
             * don con lai giu nguyen thu tu nop, dung cai ta vua chong.
             */
            thatBai.push({
                id: requestId,
                error: (error as Error).message
            });
        }
    }

    return {
        total: requestIds.length,
        succeeded: ketQua.length,
        failed: thatBai.length,

        /*
         * KHONG tra ve `thuTuChi`. In ra la tu tay dua lai dung thu tu
         * ma ham nay sinh ra de giau. Chi tra ket qua theo thu tu NOP.
         */
        results: requestIds
            .map((id) =>
                ketQua.find((r) => String(r.id) === String(id))
            )
            .filter(Boolean),

        failures: thatBai,
        shuffled: true
    };
}

module.exports = { reviewWithdrawalRequest, reviewWithdrawalBatch };

if (require.main === module) {
    require("../cli/reviewWithdrawalRequestCli")
        .runReviewWithdrawalRequestCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
