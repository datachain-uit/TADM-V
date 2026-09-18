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
    studentId: string | number,
    rho?: string
) {
    if (!universityId || !staffId || !studentId) {
        throw new Error(
            "universityId, staffId and studentId are required"
        );
    }

    return withDatabaseCleanup(
        () => issueScholarship(universityId, staffId, studentId, rho)
    );
}

async function approveRootController(
    poolId: string,
    staffId: string
) {
    if (!poolId || !staffId) {
        throw new Error("poolId and staffId are required");
    }

    return withDatabaseCleanup(
        () => approveRoot(poolId, staffId)
    );
}

module.exports = {
    issueScholarshipController,
    approveRootController
};
