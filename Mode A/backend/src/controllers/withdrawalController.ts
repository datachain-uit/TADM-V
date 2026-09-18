const {
    createWithdrawalRequest
} = require("../services/createWithdrawalRequestService");
const {
    reviewWithdrawalRequest,
    reviewWithdrawalBatch
} = require("../services/reviewWithdrawalRequestService");
const {
    withDatabaseCleanup
} = require("./databaseController");

async function createWithdrawalRequestController(
    submission: any
) {
    if (!submission || typeof submission !== "object") {
        throw new Error("Withdrawal submission is required");
    }

    return withDatabaseCleanup(
        () => createWithdrawalRequest(submission)
    );
}

async function reviewWithdrawalRequestController(
    requestId: string,
    staffId: string,
    decision: "approve" | "reject"
) {
    if (
        !requestId
        || !staffId
        || !["approve", "reject"].includes(decision)
    ) {
        throw new Error(
            "A requestId, staffId and approve|reject decision are required"
        );
    }

    return withDatabaseCleanup(
        () => reviewWithdrawalRequest(requestId, staffId, decision)
    );
}

/*
 * Duyet THEO LO — thu tu chi tien do he thong xao tron.
 * Xem `services/reviewWithdrawalRequestService.ts` de biet vi sao can.
 */
async function reviewWithdrawalBatchController(
    requestIds: string[],
    staffId: string,
    decision: "approve" | "reject"
) {
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
        throw new Error(
            "requestIds must be a non-empty array"
        );
    }

    if (!staffId || !decision) {
        throw new Error(
            "staffId and decision are required"
        );
    }

    return withDatabaseCleanup(
        () => reviewWithdrawalBatch(requestIds, staffId, decision)
    );
}

module.exports = {
    createWithdrawalRequestController,
    reviewWithdrawalRequestController,
    reviewWithdrawalBatchController
};
