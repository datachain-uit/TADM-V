const {
    authorizeStaff
} = require("./authorizeStaffService");

const mongoose = require("mongoose");
const {
    ScholarshipPool
} = require("../models/ScholarshipPool");
const {
    assertUnsignedWei,
    deployShieldedPool
} = require("../clients/blockchain/shieldedPoolClient");

async function deployScholarshipPool(
    poolId: string,
    staffId: string,
    initialFundingWei: string,
    universityPrivateKey?: string
) {
    if (!mongoose.Types.ObjectId.isValid(poolId)) {
        throw new Error("Invalid scholarship pool id");
    }

    const poolForAuth = await ScholarshipPool.findById(poolId);
    if (!poolForAuth) {
        throw new Error("Scholarship pool not found");
    }
    // K9 — trien khai pool thuoc Phong KH-TC.
    await authorizeStaff(
        String(poolForAuth.university),
        staffId,
        "FINANCE"
    );

    const fundingWei = assertUnsignedWei(
        initialFundingWei,
        "initialFundingWei"
    );
    const pool = await ScholarshipPool.findOneAndUpdate(
        {
            _id: poolId,
            status: {
                $in: [
                    "PENDING_DEPLOYMENT",
                    "DEPLOYMENT_FAILED"
                ]
            }
        },
        {
            $set: {
                status: "DEPLOYING",
                initialFundingWei: fundingWei,
                deploymentError: undefined
            }
        },
        { new: true }
    );

    if (!pool) {
        throw new Error("Pool is not awaiting deployment");
    }

    try {
        /*
         * V1(b) — menh gia co dinh cua pool, lay tu chinh document pool.
         * Khong dat thi "0" = khong cuong che, y nhu truoc.
         */
        const result = await deployShieldedPool(
            pool.universityAddress,
            fundingWei,
            universityPrivateKey,
            String(pool.denominationWei ?? "0")
        );

        pool.contractAddress = result.contractAddress;
        pool.universityAddress = result.universityAddress;
        pool.chainId = result.chainId;
        pool.deploymentTransactionHash =
            result.transactionHash;
        pool.deploymentGasUsed = result.gasUsed;
        pool.status = "DEPLOYED";
        pool.deployedAt = new Date();
        pool.deploymentError = undefined;
        await pool.save();

        console.log(
            "deployment gasUsed:",
            result.gasUsed
        );

        return {
            pool,
            balanceWei: result.balanceWei,
            gasUsed: result.gasUsed
        };
    } catch (error: any) {
        pool.status = "DEPLOYMENT_FAILED";
        pool.deploymentError = error?.message || String(error);
        await pool.save();
        throw error;
    }
}

module.exports = {
    deployScholarshipPool
};

if (require.main === module) {
    require("../cli/poolCli")
        .runDeployPoolCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
