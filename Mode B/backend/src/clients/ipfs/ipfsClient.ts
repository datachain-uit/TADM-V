require("dotenv").config({ quiet: true });

const { create } = require("ipfs-http-client");
const crypto = require("crypto");

const {
    runProver
} = require("../prover/halo2ProverClient");

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
// STUDENT PRIVATE KEY -> PUBLIC KEY
// DÙNG CHO DEMO GANACHE
// =========================

function derivePublicKeyFromPrivateKey(
    privateKeyHex: string
) {
    const privateKey =
        Buffer.from(
            cleanHex(privateKeyHex),
            "hex"
        );

    if (privateKey.length !== 32) {
        throw new Error(
            "Private key must be 32 bytes"
        );
    }

    const ecdh =
        crypto.createECDH(
            "secp256k1"
        );

    ecdh.setPrivateKey(
        privateKey
    );

    const publicKey =
        ecdh.getPublicKey(
            undefined,
            "uncompressed"
        );

    return "0x" + publicKey.toString("hex");
}

// =========================
// RANDOM RHO
// =========================

/*
 * A26 (12/09/2026) — `rho` do RUST lay mau; Node chi doi dinh dang.
 *
 * Truoc day `crypto.randomBytes(31)`: khong bao gio vuot modulus
 * nhung vut 7-8 bit entropy de ne no, va lech voi ADV (32 byte).
 * Nay prover lay mau bac bo trong truong nen deu tuyet doi tren
 * [0, r), va hai nhanh dung CHUNG mot quy uoc.
 */
function generateRandomRho() {
    const ketQua =
        runProver(
            "rho",
            {}
        );

    return BigInt(
        String(ketQua.rho)
    ).toString(10);
}

// =========================
// CREATE STUDENT NOTE
// =========================

/*
 * A23 (30/08) — `rho` CO THE TRUYEN VAO, de dinh tinh dung CHUNG
 * dataset voi dinh luong.
 *
 * Mac dinh van sinh ngau nhien — do la hanh vi that cua he. Chi runner
 * dinh tinh moi truyen `rho` co san tu `experiments/data/dataset_n*.json`
 * de hai thi nghiem chay tren DUNG MOT tap sinh vien va DUNG MOT note.
 */
function createStudentNote(
    studentId: number,
    amount: string | number,
    rho?: string
) {
    if (rho !== undefined && !/^\d+$/.test(String(rho))) {
        throw new Error(
            "rho must be a decimal integer string when supplied"
        );
    }

    return {
        student_id: studentId,
        // amount: amount,
        amount: String(amount),
        rho: rho !== undefined ? String(rho) : generateRandomRho()
    };
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
// ENCRYPT NOTE BY STUDENT PUBLIC KEY
// =========================

function encryptNoteForStudent(
    note: any,
    studentPublicKeyHex: string
) {
    const studentPublicKey =
        Buffer.from(
            cleanHex(studentPublicKeyHex),
            "hex"
        );

    if (studentPublicKey.length !== 65) {
        throw new Error(
            "Student public key must be 65 bytes"
        );
    }

    if (studentPublicKey[0] !== 4) {
        throw new Error(
            "Student public key must start with 0x04"
        );
    }

    const ephemeral =
        crypto.createECDH(
            "secp256k1"
        );

    ephemeral.generateKeys();

    const sharedSecret =
        ephemeral.computeSecret(
            studentPublicKey
        );

    const aesKey =
        deriveAesKey(
            sharedSecret
        );

    const iv =
        crypto.randomBytes(12);

    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            aesKey,
            iv
        );

    const plaintext =
        Buffer.from(
            JSON.stringify(note),
            "utf8"
        );

    const ciphertext =
        Buffer.concat([
            cipher.update(plaintext),
            cipher.final()
        ]);

    const authTag =
        cipher.getAuthTag();

    return {
        version:
            "ecdh-secp256k1-aes-256-gcm-v1",

        ephemeralPublicKey:
            "0x" +
            ephemeral
                .getPublicKey(
                    undefined,
                    "uncompressed"
                )
                .toString("hex"),

        iv:
            iv.toString("hex"),

        authTag:
            authTag.toString("hex"),

        ciphertext:
            ciphertext.toString("hex")
    };
}

// =========================
// UPLOAD ENCRYPTED NOTE TO IPFS
// =========================

async function uploadToIpfs(
    note: any,
    studentPublicKeyHex: string
) {
    const encryptedNote =
        encryptNoteForStudent(
            note,
            studentPublicKeyHex
        );

    const result =
        await ipfs.add(
            JSON.stringify(encryptedNote)
        );

    return result.cid.toString();
}

module.exports = {
    uploadToIpfs,
    createStudentNote,
    generateRandomRho,
    derivePublicKeyFromPrivateKey,
    encryptNoteForStudent
};
