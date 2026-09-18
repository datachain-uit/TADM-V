const { authorizeStaff } = require("./authorizeStaffService");
const { ScholarshipPool } = require("../models/ScholarshipPool");
const { StudentScholarship } = require("../models/StudentScholarship");
const { UniversityStudent } = require("../models/UniversityStudent");
const { getWeb3 } = require("../clients/blockchain/blockchainClient");

/*
 * A22 (30/08) — PHAI noi ro dang ky vao CHUONG TRINH NAO.
 *
 * Tu A19 mot truong co NHIEU pool. Chi biet `universityId` thi khong du.
 * `poolId` BAT BUOC.
 *
 * Van giu `universityId` vi no dung cho GAC QUYEN (`authorizeStaff` chay
 * truoc) va de KIEM CHEO pool do co thuoc truong do khong.
 */
async function registerStudentWallet(universityId: string, staffId: string, poolId: string, email: string, walletAddress: string, publicKey: string) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");

    if (!getWeb3().utils.isAddress(walletAddress)) throw new Error("Invalid student wallet");
    if (!/^0x04[0-9a-fA-F]{128}$/.test(publicKey)) throw new Error("Public key must be an uncompressed secp256k1 key");
    const student = await UniversityStudent.findOne({
        university: universityId,
        email: email.toLowerCase(),
    });
    if (!student) throw new Error("Student not found");
    if (student.eligibilityStatus !== "ELIGIBLE" || student.financeStatus !== "APPROVED" || !student.amountWei) {
        throw new Error("Student must pass eligibility and finance approval first");
    }
    // A22 — tra pool THEO poolId, va kiem cheo no thuoc dung truong.
    if (!poolId) {
        throw new Error(
            "poolId is required: a university may run several scholarship"
            + " programs, so the caller must say which pool to register into"
        );
    }

    const pool = await ScholarshipPool.findOne({
        _id: poolId,
        status: "DEPLOYED",
    });
    if (!pool) throw new Error("Deployed scholarship pool not found");

    if (String(pool.university) !== String(universityId)) {
        throw new Error("The deployed pool does not belong to this university");
    }

    /*
     * A21 — MOT VI CHI DUOC DUNG CHO DUNG MOT SUAT HOC BONG.
     *
     * Index toan cuc tren `walletAddress` da chan o tang database, nhung
     * no nem `E11000` kho doc. Kiem o day de bao loi ro rang.
     *
     * Chan VINH VIEN: dung lai vi o hai chuong trinh thi quan sat vien
     * thay cung mot dia chi o hai `event Withdraw`, giao hai tap ung
     * vien => tap an danh co lai. Su kien tren chuoi khong bao gio mat.
     */
    const viDaDung = await StudentScholarship.findOne({
        walletAddress: walletAddress.toLowerCase(),
    });
    if (viDaDung) {
        throw new Error(
            "Wallet address is already used by another scholarship (pool "
            + String(viDaDung.pool) + "). Each scholarship program needs its"
            + " OWN address: reusing one lets an observer link the two payouts"
            + " and shrinks the anonymity set. Register a NEW address."
        );
    }

    return StudentScholarship.create({
        pool: pool._id,
        universityStudent: student._id,
        walletAddress: walletAddress.toLowerCase(),
        publicKey,
        amountWei: student.amountWei,
        status: "WALLET_REGISTERED",
    });
}



module.exports = { registerStudentWallet };

if (require.main === module) {
    require("../cli/studentCli")
        .runWalletCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
