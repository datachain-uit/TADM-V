const {
    createUniversityController
} = require("../controllers/universityController");
const {
    printJson
} = require("../utils/serviceOutput");

async function runCreateUniversityCli(
    args: string[] = process.argv.slice(2)
) {
    const [name, walletAddress] = args;

    if (!name || !walletAddress) {
        throw new Error(
            "Usage: npx ts-node src/cli/createUniversityCli.ts <name> <walletAddress>"
        );
    }

    printJson(
        await createUniversityController(name, walletAddress)
    );
}

module.exports = {
    runCreateUniversityCli
};

if (require.main === module) {
    runCreateUniversityCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
