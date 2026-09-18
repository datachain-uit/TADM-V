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

module.exports = {
    createStudentProfileController: (
        universityId: string,
        staffId: string,
        studentId: number,
        email: string
    ) => withDatabaseCleanup(
        () => createStudentProfile(universityId, staffId, studentId, email)
    ),
    approveEligibilityController: (
        universityId: string,
        staffId: string,
        studentId: number,
        decision: "approve" | "reject"
    ) => withDatabaseCleanup(
        () => approveEligibility(
            universityId,
            staffId,
            studentId,
            decision
        )
    ),
    approveFinanceController: (
        universityId: string,
        staffId: string,
        studentId: number,
        amountWei: string
    ) => withDatabaseCleanup(
        () => approveFinance(
            universityId,
            staffId,
            studentId,
            amountWei
        )
    ),
    // A22 — `poolId` BAT BUOC: mot truong co the co nhieu chuong trinh.
    registerStudentWalletController: (
        universityId: string,
        staffId: string,
        poolId: string,
        email: string,
        walletAddress: string,
        publicKey: string
    ) => withDatabaseCleanup(
        () => registerStudentWallet(
            universityId,
            staffId,
            poolId,
            email,
            walletAddress,
            publicKey
        )
    )
};
