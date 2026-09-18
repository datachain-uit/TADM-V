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
    submission: unknown
) {
    if (!submission) {
        throw new Error(
            "Withdrawal submission payload is required"
        );
    }

    return withDatabaseCleanup(
        () => createWithdrawalRequest(submission)
    );
}

async function reviewWithdrawalRequestController(
    requestId: string,
    staffId: string,
    decision: string
) {
    if (!requestId || !staffId || !decision) {
        throw new Error(
            "requestId, staffId and decision are required"
        );
    }

    return withDatabaseCleanup(
        () => reviewWithdrawalRequest(requestId, staffId, decision)
    );
}

/*
 * Duyet THEO LO — thu tu chi tien do he thong xao tron.
 *
 * Xem `services/reviewWithdrawalRequestService.ts` phan
 * `reviewWithdrawalBatch` de biet vi sao can: bien phap chong kenh thu
 * tu truoc day CHI ton tai trong file thi nghiem, luong that khong co.
 */
async function reviewWithdrawalBatchController(
    requestIds: string[],
    staffId: string,
    decision: string
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
