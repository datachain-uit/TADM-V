const {
    createScholarshipPool
} = require("../services/createScholarshipPoolService");
const {
    deployScholarshipPool
} = require("../services/deployScholarshipPoolService");
const {
    fundScholarshipPool
} = require("../services/fundScholarshipPoolService");
const {
    getScholarshipPoolBalance
} = require("../services/getScholarshipPoolBalanceService");
const {
    withDatabaseCleanup
} = require("./databaseController");

// `programName` tuy chon — S-36: mot truong nhieu chuong trinh.
async function createPoolController(
    universityId: string,
    staffId: string,
    programName?: string,
    viVanHanh?: string,
    // V1(b) — menh gia cuong che; de trong = khong cuong che (nhu cu).
    denominationWei?: string
) {
    if (!universityId || !staffId) {
        throw new Error("universityId and staffId are required");
    }

    return withDatabaseCleanup(
        () => createScholarshipPool(
            universityId,
            staffId,
            programName,
            viVanHanh,
            denominationWei
        )
    );
}

async function deployPoolController(
    poolId: string,
    staffId: string,
    initialFundingWei = "0"
) {
    if (!poolId || !staffId) {
        throw new Error("poolId and staffId are required");
    }

    return withDatabaseCleanup(
        () => deployScholarshipPool(poolId, staffId, initialFundingWei)
    );
}

async function fundPoolController(
    poolId: string,
    staffId: string,
    amountWei: string,
    sponsorAddress: string
) {
    if (!poolId || !staffId || !amountWei || !sponsorAddress) {
        throw new Error(
            "poolId, staffId, amountWei and sponsorAddress are required"
        );
    }

    return withDatabaseCleanup(
        () => fundScholarshipPool(poolId, staffId, amountWei, sponsorAddress)
    );
}

async function readPoolBalanceController(
    poolId: string
) {
    if (!poolId) {
        throw new Error("poolId is required");
    }

    return withDatabaseCleanup(
        () => getScholarshipPoolBalance(poolId)
    );
}

module.exports = {
    createPoolController,
    deployPoolController,
    fundPoolController,
    readPoolBalanceController
};
