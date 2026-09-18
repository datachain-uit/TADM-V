const {
    createPoolController,
    deployPoolController,
    fundPoolController,
    readPoolBalanceController
} = require("../controllers/poolController");
const {
    printJson
} = require("../utils/serviceOutput");

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

    printJson(
        await createPoolController(universityId, staffId, programName)
    );
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

    printJson(
        await deployPoolController(poolId, staffId, initialFundingWei)
    );
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

    printJson(
        await fundPoolController(poolId, staffId, amountWei, sponsorAddress)
    );
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

    printJson(
        await readPoolBalanceController(poolId)
    );
}

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
    create: runCreatePoolCli,
    deploy: runDeployPoolCli,
    fund: runFundPoolCli,
    balance: runPoolBalanceCli
};

async function runPoolCli(
    argv: string[] = process.argv.slice(2)
) {
    const [subcommand, ...rest] = argv;
    const handler = subcommand
        ? SUBCOMMANDS[subcommand]
        : undefined;

    if (!handler) {
        throw new Error(
            "Usage: npx ts-node src/cli/poolCli.ts <create|deploy|fund|balance> ..."
        );
    }

    await handler(rest);
}

module.exports = {
    runPoolCli,
    runCreatePoolCli,
    runDeployPoolCli,
    runFundPoolCli,
    runPoolBalanceCli
};

if (require.main === module) {
    runPoolCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
