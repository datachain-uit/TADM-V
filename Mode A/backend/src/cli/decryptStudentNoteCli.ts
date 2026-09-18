process.env.DOTENV_CONFIG_QUIET = "true";

// Keep stdout machine-readable for piping into the backend.
console.log = (...args: any[]) => {
    console.error(...args);
};

const {
    getStudentFromIpfs
} = require("../clients/ipfs/encryptedNoteStorage");

async function runDecryptStudentNoteCli(
    args: string[] = process.argv.slice(2)
) {
    const [cid, studentPrivateKey] = args;

    if (!cid || !studentPrivateKey) {
        throw new Error(
            "Usage: npx ts-node src/cli/decryptStudentNoteCli.ts <cid> <studentPrivateKey>"
        );
    }

    const note = await getStudentFromIpfs(
        cid,
        studentPrivateKey
    );

    if (
        !note
        || !note.student_id
        || !note.amount
        || !note.rho
    ) {
        throw new Error(
            "Decrypted note has an invalid structure"
        );
    }

    process.stdout.write(JSON.stringify({ cid, note }));
}

function handleDecryptError(error: any) {
    console.error("STUDENT NOTE DECRYPTION FAILED");
    console.error(error);
    process.exitCode = 1;
}

module.exports = {
    runDecryptStudentNoteCli,
    handleDecryptError
};

if (require.main === module) {
    runDecryptStudentNoteCli().catch(handleDecryptError);
}
