const {
    createWithdrawalRequestController
} = require("../controllers/withdrawalController");
const {
    readJsonFromStdin
} = require("../utils/readJsonStdin");

async function runCreateWithdrawalRequestCli() {
    return createWithdrawalRequestController(
        readJsonFromStdin()
    );
}

module.exports = {
    runCreateWithdrawalRequestCli
};

if (require.main === module) {
    runCreateWithdrawalRequestCli().catch((error: any) => {
        console.error("\nCREATE WITHDRAWAL REQUEST FAILED");
        console.error(error);
        process.exitCode = 1;
    });
}
