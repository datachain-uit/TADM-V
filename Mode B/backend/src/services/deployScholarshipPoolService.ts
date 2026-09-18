const { authorizeStaff } = require("./authorizeStaffService");
const { ScholarshipPool } = require("../models/ScholarshipPool");
require("../models/University");
const { deployContract, getWeb3, requireUnlockedAccount } = require("../clients/blockchain/blockchainClient");

async function deployScholarshipPool(poolId: string, staffId: string, initialFundingWei = "0") {
    if (!/^\d+$/.test(initialFundingWei)) throw new Error("initialFundingWei must be an unsigned integer");
    const pool = await ScholarshipPool.findById(poolId).populate("university");
    if (!pool) throw new Error("Pool not found");

    // K9 — trien khai pool thuoc Phong KH-TC.
    await authorizeStaff(String((pool.university as any)._id || pool.university), staffId, "FINANCE");
    if (pool.status !== "PENDING_DEPLOYMENT") throw new Error("Pool is not pending deployment");
    const university = pool.university as any;
    /*
     * Vi KY GIAO DICH cua pool nay. `pool.operatorAddress` de trong thi
     * roi ve vi truong => hanh vi Y NHU TRUOC 2026-09-01.
     *
     * Cho phep MOI CHUONG TRINH mot vi rieng => chuoi nonce rieng => cac
     * chuong trinh cua cung mot truong khong phai cho nhau. Hop dong da
     * ho tro san (`school = msg.sender`, gan rieng tung pool); truoc day
     * backend cung hoa mot vi cho tat ca.
     */
    const deployerAddress =
        pool.operatorAddress || university.walletAddress;
    const deployer = await requireUnlockedAccount(deployerAddress);
    pool.status = "DEPLOYING";
    await pool.save();
    try {
        const verifierDeployment = await deployContract("Halo2Verifier", deployer);
        const verifierAddress = String(verifierDeployment.contract.options.address).toLowerCase();
        /*
         * V1(b) — tham so constructor thu hai: `poolDenomination`.
         * Lay tu document pool; "0" = khong cuong che menh gia.
         */
        const poolDeployment = await deployContract(
            "ShieldedPool",
            deployer,
            [verifierAddress, String(pool.denominationWei ?? "0")],
            initialFundingWei
        );
        pool.verifierAddress = verifierAddress;
        pool.contractAddress = String(poolDeployment.contract.options.address).toLowerCase();
        pool.chainId = BigInt(await getWeb3().eth.getChainId()).toString();
        pool.initialFundingWei = initialFundingWei;
        pool.status = "DEPLOYED";
        pool.deployedAt = new Date();
        pool.deploymentError = undefined;
        await pool.save();
        return pool;
    } catch (error) {
        pool.status = "DEPLOYMENT_FAILED";
        pool.deploymentError = (error as Error).message;
        await pool.save();
        throw error;
    }
}



module.exports = { deployScholarshipPool };

if (require.main === module) {
    require("../cli/poolCli")
        .runDeployPoolCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
