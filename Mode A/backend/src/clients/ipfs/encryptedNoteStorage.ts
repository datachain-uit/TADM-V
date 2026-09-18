const {
    getIpfsClient
} = require("./ipfsClient");
const {
    encryptNoteForStudent,
    decryptNoteWithStudentPrivateKey
} = require("./noteEncryption");

async function uploadToIpfs(
    studentData: any,
    studentPublicKeyHex: string
): Promise<string> {
    const encryptedNote = encryptNoteForStudent(
        studentData,
        studentPublicKeyHex
    );
    const result = await getIpfsClient().add(
        JSON.stringify(encryptedNote)
    );

    return result.cid.toString();
}

async function readEncryptedNote(cid: string) {
    const chunks: Buffer[] = [];

    for await (const chunk of getIpfsClient().cat(cid)) {
        chunks.push(Buffer.from(chunk));
    }

    return JSON.parse(
        Buffer.concat(chunks).toString("utf8")
    );
}

async function getStudentFromIpfs(
    cid: string,
    studentPrivateKeyHex: string
) {
    const encryptedNote = await readEncryptedNote(cid);

    return decryptNoteWithStudentPrivateKey(
        encryptedNote,
        studentPrivateKeyHex
    );
}

module.exports = {
    uploadToIpfs,
    readEncryptedNote,
    getStudentFromIpfs
};
