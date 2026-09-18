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

async function createStudentProfileController(
    universityId: string,
    studentId: string | number,
    email: string,
    staffId: string
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
