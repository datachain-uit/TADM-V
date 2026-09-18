const {
    issueScholarship
} = require("../services/issueScholarshipService");
const {
    approveRoot
} = require("../services/approveRootService");
const {
    withDatabaseCleanup
} = require("./databaseController");

// A23 — `rho` tuy chon: runner dinh tinh truyen tu dataset dinh luong.
async function issueScholarshipController(
    universityId: string,
    staffId: string,
    studentId: number,
    rho?: string
) {
    if (
        !universityId
        || !Number.isSafeInteger(studentId)
        || studentId <= 0
    ) {
        throw new Error(
            "A valid universityId and positive studentId are required"
        );
    }

    return withDatabaseCleanup(
        () => issueScholarship(universityId, staffId, studentId, rho)
    );
}

async function approveRootController(
    poolId: string | undefined,
    staffId: string
) {
    if (!staffId) {
        throw new Error(
            "A staffId with role STUDENT_AFFAIRS is required"
        );
    }

    return withDatabaseCleanup(
        () => approveRoot(poolId, staffId)
    );
}

module.exports = {
    issueScholarshipController,
    approveRootController
};
