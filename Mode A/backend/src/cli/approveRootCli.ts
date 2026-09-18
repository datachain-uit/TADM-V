const {
    approveRootController
} = require("../controllers/scholarshipController");

async function runApproveRootCli(
    args: string[] = process.argv.slice(2)
) {
    const [poolId, staffId] = args;

    if (!staffId) {
        throw new Error(
            "Usage: root:approve <poolId> <staffId>"
            + " | staffId phai co role STUDENT_AFFAIRS"
        );
    }

    return approveRootController(poolId, staffId);
}

module.exports = {
    runApproveRootCli
};

if (require.main === module) {
    runApproveRootCli().catch((error: any) => {
        console.error("\nAPPROVE ROOT FAILED");
        console.error(error);
        process.exitCode = 1;
    });
}
