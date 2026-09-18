const { ScholarshipPool } = require("../models/ScholarshipPool");
const { University } = require("../models/University");
const { getPool, getWeb3, sameAddress } = require("../clients/blockchain/blockchainClient");

async function getScholarshipPoolBalance(poolId: string) {
    const pool = await ScholarshipPool.findById(poolId);
    if (!pool || pool.status !== "DEPLOYED" || !pool.contractAddress) throw new Error("Deployed pool not found");
    const university = await University.findById(pool.university);
    if (!university) throw new Error("University not found");
    const contract = getPool(pool.contractAddress);
    const [balanceWei, school] = await Promise.all([
        getWeb3().eth.getBalance(pool.contractAddress),
        contract.methods.school().call(),
    ]);
    /*
     * So voi vi VAN HANH cua pool, khong phai vi truong: moi pool co the
     * duoc deploy bang mot vi rieng (xem `operatorAddress`).
     */
    const operatorAddress =
        pool.operatorAddress || university.walletAddress;

    if (!sameAddress(String(school), operatorAddress)) throw new Error("On-chain school does not match the pool operator");
    return { poolId: pool.id, contractAddress: pool.contractAddress, balanceWei: String(balanceWei) };
}



module.exports = { getScholarshipPoolBalance };

if (require.main === module) {
    require("../cli/poolCli")
        .runPoolBalanceCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
