const {
    createPublicKeyFromPrivateKey,
    createEncryptedNote,
    fullFlow
} = require("../services/generateStudentFile");
const {
    handleCliError
} = require("./cliErrorHandler");

async function runGenerateStudentFileCli(
    args: string[] = process.argv.slice(2)
) {
    const [mode, first, second, third] = args;

    if (mode === "derive") {
        if (!first) {
            throw new Error(
                "Usage: npx ts-node src/cli/generateStudentFileCli.ts derive <studentPrivateKey>"
            );
        }

        createPublicKeyFromPrivateKey(first);
        return;
    }

    if (mode === "create") {
        const studentId = Number(first);

        if (!studentId || !second || !third) {
            throw new Error(
                "Usage: npx ts-node src/cli/generateStudentFileCli.ts create <studentId> <amountWei> <studentPublicKey>"
            );
        }

        console.log(
            "CREATE RESULT:",
            await createEncryptedNote(
                studentId,
                second,
                third
            )
        );
        return;
    }

    if (mode === "full") {
        const studentId = Number(first);

        if (!studentId || !second || !third) {
            throw new Error(
                "Usage: npx ts-node src/cli/generateStudentFileCli.ts full <studentId> <amountWei> <studentPrivateKey>"
            );
        }

        console.log(
            "FULL FLOW RESULT:",
            await fullFlow(studentId, second, third)
        );
        return;
    }

    throw new Error("Mode must be: derive, create, or full");
}

module.exports = {
    runGenerateStudentFileCli
};

if (require.main === module) {
    runGenerateStudentFileCli().catch(handleCliError);
}
