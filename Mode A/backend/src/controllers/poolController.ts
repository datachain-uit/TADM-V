const {
    createScholarshipPool
} = require("../services/createScholarshipPoolService");
const {
    deployScholarshipPool
} = require("../services/deployScholarshipPoolService");
const {
    fundPool
} = require("../services/fundScholarshipPoolService");
const {
    readPoolBalance
} = require("../services/getScholarshipPoolBalanceService");
const {
    withDatabaseCleanup
} = require("./databaseController");

function withPoolDatabase<T>(operation: () => Promise<T>) {
    return withDatabaseCleanup(operation);
}

module.exports = {
    // `programName` tuy chon — S-36: mot truong nhieu chuong trinh.
    createPoolController: (
        universityId: string,
        staffId: string,
        programName?: string,
        viVanHanh?: string,
        // V1(b) — menh gia cuong che; de trong = khong cuong che (nhu cu).
        denominationWei?: string
    ) =>
        withPoolDatabase(
            () => createScholarshipPool(
                universityId,
                staffId,
                programName,
                viVanHanh,
                denominationWei
            )
        ),
    deployPoolController: (
        poolId: string,
        staffId: string,
        initialFundingWei: string,
        privateKey?: string
    ) => withPoolDatabase(
        () => deployScholarshipPool(
            poolId,
            staffId,
            initialFundingWei,
            privateKey
        )
    ),
    fundPoolController: (
        poolId: string,
        staffId: string,
        amountWei: string,
        sponsorAddress: string
    ) => withPoolDatabase(
        () => fundPool(poolId, staffId, amountWei, sponsorAddress)
    ),
    readPoolBalanceController: (poolId: string) =>
        withPoolDatabase(() => readPoolBalance(poolId))
};
