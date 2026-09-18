require("dotenv").config({ quiet: true });

const { create } = require("ipfs-http-client");
const crypto = require("crypto");

const ipfs = create({
    host: process.env.IPFS_HOST || "127.0.0.1",
    port: Number(process.env.IPFS_PORT || 5001),
    protocol: process.env.IPFS_PROTOCOL || "http"
});

// =========================
// CLEAN HEX
// =========================

function cleanHex(value: string) {
    return value.startsWith("0x")
        ? value.slice(2)
        : value;
}

// =========================
// DERIVE AES KEY FROM ECDH
// =========================

function deriveAesKey(
    sharedSecret: Buffer
) {
    return Buffer.from(
        crypto.hkdfSync(
            "sha256",
            sharedSecret,
            Buffer.alloc(0),
            Buffer.from(
                "scholarship-note-encryption-v1"
            ),
            32
        )
    );
}

// =========================
// DECRYPT NOTE
// =========================

function decryptNoteWithStudentPrivateKey(
    encryptedNote: any,
    studentPrivateKeyHex: string
) {
    if (
        encryptedNote.version !==
        "ecdh-secp256k1-aes-256-gcm-v1"
    ) {
        throw new Error(
            "Unsupported encrypted note version"
        );
    }

    const studentPrivateKey =
        Buffer.from(
            cleanHex(studentPrivateKeyHex),
            "hex"
        );

    if (studentPrivateKey.length !== 32) {
        throw new Error(
            "Student private key must be 32 bytes"
        );
    }

    const ephemeralPublicKey =
        Buffer.from(
            cleanHex(
                encryptedNote.ephemeralPublicKey
            ),
            "hex"
        );

    const studentECDH =
        crypto.createECDH(
            "secp256k1"
        );

    studentECDH.setPrivateKey(
        studentPrivateKey
    );

    const sharedSecret =
        studentECDH.computeSecret(
            ephemeralPublicKey
        );

    const aesKey =
        deriveAesKey(
            sharedSecret
        );

    const iv =
        Buffer.from(
            encryptedNote.iv,
            "hex"
        );

    const authTag =
        Buffer.from(
            encryptedNote.authTag,
            "hex"
        );

    const ciphertext =
        Buffer.from(
            encryptedNote.ciphertext,
            "hex"
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            aesKey,
            iv
        );

    decipher.setAuthTag(
        authTag
    );

    const plaintext =
        Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);

    return JSON.parse(
        plaintext.toString("utf8")
    );
}

// =========================
// GET STUDENT NOTE FROM IPFS
// =========================

// Doc envelope THO tu IPFS, khong giai ma.
// Runner dinh tinh can no de soi envelope co that su chi chua
// ciphertext hay khong (tieu chi 3 cua outline muc 2.1.3).
async function readEncryptedNote(cid: string) {
    const chunks = [];

    for await (const chunk of ipfs.cat(cid)) {
        chunks.push(
            Buffer.from(chunk)
        );
    }

    return JSON.parse(
        Buffer
            .concat(chunks)
            .toString()
    );
}

async function getStudentFromIpfs(
    cid: string,
    studentPrivateKeyHex: string
) {
    const encryptedNote =
        await readEncryptedNote(cid);

    return decryptNoteWithStudentPrivateKey(
        encryptedNote,
        studentPrivateKeyHex
    );
}

module.exports = {
    getStudentFromIpfs,
    readEncryptedNote,
    decryptNoteWithStudentPrivateKey
};
