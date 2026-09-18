const {
    decryptStudentNote
} = require("../clients/ipfs/noteEncryption");

/*
 * Giữ NGUYÊN hợp đồng đầu ra của bản trước refactor: một dòng JSON gọn
 * (không phải printJson 2 khoảng trắng) — FULL_FLOW_TEST.md đang pipe
 * dòng này sang bước tạo withdrawal request.
 */
async function runDecryptStudentNoteCli(
    args: string[] = process.argv.slice(2)
) {
    const [cid, privateKey] = args;

    if (!cid || !privateKey) {
        throw new Error(
            "Usage: npx ts-node src/cli/decryptStudentNoteCli.ts <cid> <studentPrivateKey>"
        );
    }

    const note = await decryptStudentNote(cid, privateKey);
    process.stdout.write(`${JSON.stringify(note)}\n`);
}

module.exports = {
    runDecryptStudentNoteCli
};

if (require.main === module) {
    runDecryptStudentNoteCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
