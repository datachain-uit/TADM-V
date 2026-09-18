const {
    createUniversityController
} = require("../controllers/universityController");

async function runCreateUniversityCli(
    args: string[] = process.argv.slice(2)
) {
    const [name, walletAddress] = args;

    if (!name || !walletAddress) {
        throw new Error(
            "Usage: npx ts-node src/cli/createUniversityCli.ts <name> <walletAddress>"
        );
    }

    const university = await createUniversityController(
        name,
        walletAddress
    );
    console.log(JSON.stringify({
        universityId: university._id.toString(),
        name: university.name,
        walletAddress: university.walletAddress,
        status: university.status
    }, null, 2));
}

module.exports = {
    runCreateUniversityCli
};

if (require.main === module) {
    runCreateUniversityCli().catch((error: any) => {
        console.error(error);
        process.exitCode = 1;
    });
}
