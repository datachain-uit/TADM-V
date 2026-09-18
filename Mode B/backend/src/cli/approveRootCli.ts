const {
    approveRootController
} = require("../controllers/scholarshipController");
const {
    printJson
} = require("../utils/serviceOutput");

async function runApproveRootCli(
    args: string[] = process.argv.slice(2)
) {
    const [poolId, staffId] = args;

    if (!poolId || !staffId) {
        throw new Error(
            "Usage: npx ts-node src/cli/approveRootCli.ts <poolId> <staffId>"
            + " | staffId phai co role STUDENT_AFFAIRS"
        );
    }

    printJson(
        await approveRootController(poolId, staffId)
    );
}

module.exports = {
    runApproveRootCli
};

if (require.main === module) {
    runApproveRootCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
