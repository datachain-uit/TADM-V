const {
    resolveDeployedPool
} = require("../repositories/scholarshipPoolRepository");
const {
    getPoolBalance,
    assertPoolUniversity
} = require("../clients/blockchain/shieldedPoolClient");

async function readPoolBalance(poolId: string) {
    const pool = await resolveDeployedPool(poolId);
    const universityAddress = await assertPoolUniversity(
        pool.contractAddress,
        pool.universityAddress,
        pool.chainId
    );

    return {
        pool,
        universityAddress,
        balanceWei: await getPoolBalance(
            pool.contractAddress
        )
    };
}

module.exports = {
    readPoolBalance
};

if (require.main === module) {
    require("../cli/poolCli")
        .runPoolBalanceCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
