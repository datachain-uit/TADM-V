const {
    authorizeStaff
} = require("./authorizeStaffService");
const {
    universityIdOf
} = require("../utils/universityRef");

const {
    resolveDeployedPool
} = require("../repositories/scholarshipPoolRepository");
const {
    assertPoolUniversity,
    fundScholarshipPool
} = require("../clients/blockchain/shieldedPoolClient");

async function fundPool(
    poolId: string,
    staffId: string,
    amountWei: string,
    sponsorAddress: string
) {
    const pool = await resolveDeployedPool(poolId);

    // K9 — nap tien thuoc Phong KH-TC.
    await authorizeStaff(
        universityIdOf(pool.university),
        staffId,
        "FINANCE"
    );

    await assertPoolUniversity(
        pool.contractAddress,
        pool.universityAddress,
        pool.chainId
    );
    const result = await fundScholarshipPool(
        pool.contractAddress,
        amountWei,
        sponsorAddress
    );

    return {
        pool,
        ...result
    };
}

module.exports = {
    fundPool
};

if (require.main === module) {
    require("../cli/poolCli")
        .runFundPoolCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
