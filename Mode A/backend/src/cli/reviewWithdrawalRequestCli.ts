const {
    reviewWithdrawalRequestController
} = require("../controllers/withdrawalController");

async function runReviewWithdrawalRequestCli(
    args: string[] = process.argv.slice(2)
) {
    const [requestId, staffId, decisionRaw] = args;

    if (
        !requestId
        || !staffId
        || (decisionRaw !== "approve" && decisionRaw !== "reject")
    ) {
        throw new Error(
            "Usage: npx ts-node src/cli/reviewWithdrawalRequestCli.ts"
            + " <requestId> <staffId> <approve|reject>"
            + " | staffId phai co role FINANCE (Phong Ke hoach - Tai chinh)"
        );
    }

    return reviewWithdrawalRequestController(
        requestId,
        staffId,
        decisionRaw
    );
}

module.exports = {
    runReviewWithdrawalRequestCli
};

if (require.main === module) {
    runReviewWithdrawalRequestCli().catch((error: any) => {
        console.error(error);
        process.exitCode = 1;
    });
}
