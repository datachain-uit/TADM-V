const {
    createStudentProfile
} = require("../services/createStudentProfileService");
const {
    approveEligibility
} = require("../services/approveEligibilityService");
const {
    approveFinance
} = require("../services/approveFinanceService");
const {
    registerStudentWallet
} = require("../services/registerStudentWalletService");
const {
    withDatabaseCleanup
} = require("./databaseController");

/*
 * 🔴 Sua 18/09/2026 — THU TU THAM SO bi lech so voi CLI goi no.
 *
 * Truoc:  (universityId, studentId, email, staffId)
 * CLI goi: (universityId, staffId,  studentId, email)     <- cli/studentCli.ts:24
 *
 * Nen `staffId` nhan email, `studentId` nhan ma nhan su, `email` nhan MSSV. Service
 * ben duoi goi dung `createStudentProfile(universityId, staffId, studentId, email)`
 * nen no di tim nhan su mang ten la email => "Staff not found in this university".
 *
 * typecheck KHONG bat duoc: ca bon tham so deu la string (hoac string | number).
 *
 * Nay doi thu tu cho khop CLI, va khop luon nhanh off-chain — nhanh do van dung
 * tu dau (`zk-circuits-halo2-advanced/.../studentController.ts`).
 *
 * ⚠️ KHONG anh huong so lieu nao: nguoi goi duy nhat cua ham nay la `cli/studentCli.ts`.
 * Runner dinh tinh, runner an danh va `fullFlowService.ts` cua ONC goi THANG
 * `createStudentProfile` (service), khong qua controller; runner dinh luong khong
 * tao ho so sinh vien bao gio. Loi chi chan LUONG CHAY TAY bang CLI — tuc dung
 * duong ma nguoi tai lap se go theo FULL_FLOW_TEST.md.
 */
async function createStudentProfileController(
    universityId: string,
    staffId: string,
    studentId: string | number,
    email: string
) {
    if (!universityId || !staffId || !studentId || !email) {
        throw new Error(
            "universityId, staffId, studentId and email are required"
        );
    }

    return withDatabaseCleanup(
        () => createStudentProfile(universityId, staffId, studentId, email)
    );
}

async function approveEligibilityController(
    universityId: string,
    staffId: string,
    studentId: string | number,
    decision = "approve"
) {
    if (!universityId || !staffId || !studentId) {
        throw new Error(
            "universityId, staffId and studentId are required"
        );
    }

    return withDatabaseCleanup(
        () => approveEligibility(universityId, staffId, studentId, decision)
    );
}

async function approveFinanceController(
    universityId: string,
    staffId: string,
    studentId: string | number,
    amountWei: string
) {
    if (!universityId || !staffId || !studentId || !amountWei) {
        throw new Error(
            "universityId, staffId, studentId and approvedAmountWei are required"
        );
    }

    return withDatabaseCleanup(
        () => approveFinance(universityId, staffId, studentId, amountWei)
    );
}

// A22 — `poolId` BAT BUOC: mot truong co the co nhieu chuong trinh.
async function registerStudentWalletController(
    universityId: string,
    poolId: string,
    email: string,
    walletAddress: string,
    publicKey: string,
    staffId: string
) {
    if (
        !universityId || !staffId || !poolId
        || !email || !walletAddress || !publicKey
    ) {
        throw new Error(
            "universityId, staffId, poolId, email, wallet and publicKey"
            + " are required"
        );
    }

    return withDatabaseCleanup(
        () => registerStudentWallet(
            universityId,
            staffId,
            poolId,
            email,
            walletAddress,
            publicKey
        )
    );
}

module.exports = {
    createStudentProfileController,
    approveEligibilityController,
    approveFinanceController,
    registerStudentWalletController
};
