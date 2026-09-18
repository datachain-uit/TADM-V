const {
    reviewWithdrawalRequestController
} = require("../controllers/withdrawalController");
const {
    printJson
} = require("../utils/serviceOutput");

async function runReviewWithdrawalRequestCli(
    args: string[] = process.argv.slice(2)
) {
    const [requestId, staffId, decision] = args;

    if (!requestId || !staffId || !decision) {
        throw new Error(
            "Usage: npx ts-node src/cli/reviewWithdrawalRequestCli.ts <requestId> <staffId> <approve|reject>"
            + " | staffId phai co role FINANCE (Phong Ke hoach - Tai chinh)"
        );
    }

    printJson(
        await reviewWithdrawalRequestController(requestId, staffId, decision)
    );
}

module.exports = {
    runReviewWithdrawalRequestCli
};

if (require.main === module) {
    runReviewWithdrawalRequestCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
