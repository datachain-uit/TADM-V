const fs = require("fs");
const {
    computeCommitment,
    computeNullifier,
    computeMerkleRoot
} = require("../services/generateStudentFile");
const {
    derivePublicKeyFromPrivateKey
} = require("../clients/ipfs/ipfsClient");

/*
 * Giữ NGUYÊN hợp đồng đầu ra của bản trước refactor: mỗi mode ghi đúng
 * một dòng JSON ra stdout (không phải printJson 2 khoảng trắng), vì
 * prover và các bước PowerShell phía sau đang đọc đúng định dạng đó.
 */
async function runGenerateStudentFileCli(
    args: string[] = process.argv.slice(2)
) {
    const [mode, argument] = args;

    if (mode === "derive" && argument) {
        process.stdout.write(
            `${derivePublicKeyFromPrivateKey(argument)}\n`
        );
        return;
    }

    const input = JSON.parse(fs.readFileSync(0, "utf8"));

    if (mode === "commitment") {
        process.stdout.write(
            `${JSON.stringify({ commitment: computeCommitment(input) })}\n`
        );
        return;
    }

    if (mode === "nullifier") {
        process.stdout.write(
            `${JSON.stringify({ nullifier: computeNullifier(input) })}\n`
        );
        return;
    }

    if (mode === "root") {
        process.stdout.write(
            `${JSON.stringify(computeMerkleRoot(input.commitments))}\n`
        );
        return;
    }

    throw new Error(
        "Usage: npx ts-node src/cli/generateStudentFileCli.ts derive <privateKey>"
        + " | commitment|nullifier|root < JSON"
    );
}

module.exports = {
    runGenerateStudentFileCli
};

if (require.main === module) {
    runGenerateStudentFileCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
