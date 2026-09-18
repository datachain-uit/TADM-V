const crypto = require("crypto");

const {
    runRust
} = require("../prover/halo2ProverClient");

const ENCRYPTED_NOTE_VERSION =
    "ecdh-secp256k1-aes-256-gcm-v1";

const HKDF_CONTEXT =
    "scholarship-note-encryption-v1";

function cleanHex(value: string): string {
    return value.startsWith("0x")
        ? value.slice(2)
        : value;
}

function deriveAesKey(sharedSecret: Buffer): Buffer {
    return Buffer.from(
        crypto.hkdfSync(
            "sha256",
            sharedSecret,
            Buffer.alloc(0),
            Buffer.from(HKDF_CONTEXT),
            32
        )
    );
}

function derivePublicKeyFromPrivateKey(
    privateKeyHex: string
): string {
    const privateKey = Buffer.from(
        cleanHex(privateKeyHex),
        "hex"
    );

    if (privateKey.length !== 32) {
        throw new Error("Private key must be 32 bytes");
    }

    const ecdh = crypto.createECDH("secp256k1");
    ecdh.setPrivateKey(privateKey);

    return "0x" + ecdh
        .getPublicKey(undefined, "uncompressed")
        .toString("hex");
}

/*
 * A26 (12/09/2026) — `rho` do RUST lấy mẫu; Node chỉ đổi định dạng.
 *
 * Trước đây: `crypto.randomBytes(32)` → khoảng 75 % giá trị vượt
 * modulus của `Fp` rồi bị thu gọn âm thầm, và lệch với ONC (31 byte).
 * Nay prover lấy mẫu bác bỏ trong trường nên đều tuyệt đối trên
 * [0, p), và hai nhánh dùng CHUNG một quy ước.
 */
function generateRandomRho(): string {
    const ketQua =
        runRust(
            "rho",
            {}
        );

    return BigInt(
        String(ketQua.rho)
    ).toString(10);
}

/*
 * A23 (30/08) — `rho` CO THE TRUYEN VAO, de dinh tinh dung CHUNG
 * dataset voi dinh luong.
 *
 * Mac dinh van sinh ngau nhien (`generateRandomRho`) — do la hanh vi
 * that cua he. Chi runner dinh tinh moi truyen `rho` co san tu
 * `experiments/data/dataset_n*.json`, de hai thi nghiem chay tren DUNG
 * MOT tap sinh vien va DUNG MOT note.
 *
 * VI SAO CAN: khong co no thi dinh tinh sinh `rho` moi => commitment
 * khac => hai thi nghiem noi ve hai tap du lieu khac nhau, va bai
 * KHONG duoc noi "cung dau vao".
 */
function createStudentNote(
    studentId: number,
    amountWei: string,
    rho?: string
) {
    if (!/^\d+$/.test(amountWei)) {
        throw new Error(
            "amountWei must be a decimal integer string"
        );
    }

    if (BigInt(amountWei) <= 0n) {
        throw new Error(
            "amountWei must be greater than zero"
        );
    }

    if (rho !== undefined && !/^\d+$/.test(String(rho))) {
        throw new Error(
            "rho must be a decimal integer string when supplied"
        );
    }

    return {
        student_id: studentId,
        amount: amountWei,
        rho: rho !== undefined ? String(rho) : generateRandomRho()
    };
}

function encryptNoteForStudent(
    note: any,
    studentPublicKeyHex: string
) {
    const studentPublicKey = Buffer.from(
        cleanHex(studentPublicKeyHex),
        "hex"
    );

    if (
        studentPublicKey.length !== 65
        || studentPublicKey[0] !== 4
    ) {
        throw new Error(
            "Student public key must be a 65-byte uncompressed key starting with 0x04"
        );
    }

    const ephemeral = crypto.createECDH("secp256k1");
    ephemeral.generateKeys();

    const aesKey = deriveAesKey(
        ephemeral.computeSecret(studentPublicKey)
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        aesKey,
        iv
    );
    const plaintext = Buffer.from(
        JSON.stringify(note),
        "utf8"
    );
    const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
    ]);

    return {
        version: ENCRYPTED_NOTE_VERSION,
        ephemeralPublicKey: ephemeral
            .getPublicKey(undefined, "uncompressed")
            .toString("hex"),
        iv: iv.toString("hex"),
        authTag: cipher.getAuthTag().toString("hex"),
        ciphertext: ciphertext.toString("hex")
    };
}

function decryptNoteWithStudentPrivateKey(
    encryptedNote: any,
    studentPrivateKeyHex: string
) {
    if (encryptedNote.version !== ENCRYPTED_NOTE_VERSION) {
        throw new Error("Unsupported encrypted note version");
    }

    const privateKey = Buffer.from(
        cleanHex(studentPrivateKeyHex),
        "hex"
    );

    if (privateKey.length !== 32) {
        throw new Error(
            "Student private key must be 32 bytes"
        );
    }

    const ecdh = crypto.createECDH("secp256k1");
    ecdh.setPrivateKey(privateKey);

    const aesKey = deriveAesKey(
        ecdh.computeSecret(
            Buffer.from(
                cleanHex(encryptedNote.ephemeralPublicKey),
                "hex"
            )
        )
    );
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        aesKey,
        Buffer.from(encryptedNote.iv, "hex")
    );
    decipher.setAuthTag(
        Buffer.from(encryptedNote.authTag, "hex")
    );

    const plaintext = Buffer.concat([
        decipher.update(
            Buffer.from(encryptedNote.ciphertext, "hex")
        ),
        decipher.final()
    ]);

    return JSON.parse(plaintext.toString("utf8"));
}

module.exports = {
    ENCRYPTED_NOTE_VERSION,
    createStudentNote,
    generateRandomRho,
    derivePublicKeyFromPrivateKey,
    encryptNoteForStudent,
    decryptNoteWithStudentPrivateKey
};
