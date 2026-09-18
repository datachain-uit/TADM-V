const {
    createPoolController,
    deployPoolController,
    fundPoolController,
    readPoolBalanceController
} = require("../controllers/poolController");

async function runCreatePoolCli(
    args: string[] = process.argv.slice(2)
) {
    // Doi so thu 3 tuy chon: TEN CHUONG TRINH (S-36). Khong truyen thi
    // model dung `default`, nen moi lenh cu van chay y nhu truoc.
    const [universityId, staffId, ...phanConLai] = args;
    if (!universityId || !staffId) {
        throw new Error(
            "Usage: npx ts-node src/cli/poolCli.ts create <universityId> <staffId>"
            + " [programName]"
            + " | staffId phai co role FINANCE"
        );
    }

    // Ten chuong trinh co the co dau cach ma nguoi dung khong quote.
    const programName = phanConLai.join(" ").trim() || undefined;

    const pool = await createPoolController(
        universityId,
        staffId,
        programName
    );
    console.log(JSON.stringify({
        poolId: pool._id.toString(),
        universityId: pool.university.toString(),
        universityAddress: pool.universityAddress,
        programName: pool.programName,
        status: pool.status
    }, null, 2));
}

async function runDeployPoolCli(
    args: string[] = process.argv.slice(2)
) {
    const [poolId, staffId, initialFundingWei = "0"] = args;
    if (!poolId || !staffId) {
        throw new Error(
            "Usage: npx ts-node src/cli/poolCli.ts deploy <poolId> <staffId> [initialFundingWei]"
            + " | staffId phai co role FINANCE"
        );
    }

    const result = await deployPoolController(
        poolId,
        staffId,
        initialFundingWei,
        process.env.UNIVERSITY_PRIVATE_KEY
    );
    console.log(JSON.stringify({
        poolId: result.pool._id.toString(),
        contractAddress: result.pool.contractAddress,
        universityAddress: result.pool.universityAddress,
        chainId: result.pool.chainId,
        deploymentTransactionHash:
            result.pool.deploymentTransactionHash,
        deploymentGasUsed: result.pool.deploymentGasUsed,
        balanceWei: result.balanceWei,
        status: result.pool.status
    }, null, 2));
}

async function runFundPoolCli(
    args: string[] = process.argv.slice(2)
) {
    const [poolId, staffId, amountWei, sponsorAddress] = args;
    if (!poolId || !staffId || !amountWei || !sponsorAddress) {
        throw new Error(
            "Usage: npx ts-node src/cli/poolCli.ts fund <poolId> <staffId> <amountWei> <sponsorAddress>"
            + " | staffId phai co role FINANCE"
        );
    }

    const result = await fundPoolController(
        poolId,
        staffId,
        amountWei,
        sponsorAddress
    );
    console.log(JSON.stringify({
        poolId: result.pool._id.toString(),
        contractAddress: result.pool.contractAddress,
        sponsorAddress: result.sponsorAddress,
        transactionHash: result.transactionHash,
        gasUsed: result.gasUsed,
        balanceWei: result.balanceWei
    }, null, 2));
}

async function runPoolBalanceCli(
    args: string[] = process.argv.slice(2)
) {
    const [poolId] = args;
    if (!poolId) {
        throw new Error(
            "Usage: npx ts-node src/cli/poolCli.ts balance <poolId>"
        );
    }

    const result = await readPoolBalanceController(poolId);
    console.log(JSON.stringify({
        poolId: result.pool._id.toString(),
        contractAddress: result.pool.contractAddress,
        universityAddress: result.universityAddress,
        chainId: result.pool.chainId,
        balanceWei: result.balanceWei
    }, null, 2));
}

module.exports = {
    runCreatePoolCli,
    runDeployPoolCli,
    runFundPoolCli,
    runPoolBalanceCli
};

if (require.main === module) {
    const [action, ...args] = process.argv.slice(2);
    const commands: Record<string, (values: string[]) => Promise<void>> = {
        create: runCreatePoolCli,
        deploy: runDeployPoolCli,
        fund: runFundPoolCli,
        balance: runPoolBalanceCli
    };
    const command = action ? commands[action] : undefined;

    if (!command) {
        console.error(
            "Usage: npx ts-node src/cli/poolCli.ts <create|deploy|fund|balance> ..."
        );
        process.exitCode = 1;
    } else {
        command(args).catch((error: any) => {
            console.error(error);
            process.exitCode = 1;
        });
    }
}
