const { getStudentFromIpfs } = require("./encryptedNoteStorage");

async function decryptStudentNote(cid: string, privateKey: string) {
    const note = await getStudentFromIpfs(cid, privateKey);
    if (!note?.student_id || !note?.amount || !note?.rho) {
        throw new Error("Decrypted note has an invalid structure");
    }
    return { cid, note };
}


module.exports = { decryptStudentNote };

if (require.main === module) {
    require("../../cli/decryptStudentNoteCli")
        .runDecryptStudentNoteCli()
        .catch(require("../../cli/cliErrorHandler").handleCliError);
}
