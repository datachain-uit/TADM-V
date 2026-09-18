const test = require("node:test");
const assert = require("node:assert/strict");
const {
    derivePublicKeyFromPrivateKey,
    encryptNoteForStudent,
    decryptNoteWithStudentPrivateKey
} = require("../clients/ipfs/noteEncryption");

test("encrypted note exposes ciphertext only and enforces the key", () => {
    const correctKey = "11".repeat(32);
    const wrongKey = "22".repeat(32);
    const note = {
        student_id: 7,
        amount: "1000",
        rho: "123"
    };
    const encrypted = encryptNoteForStudent(
        note,
        derivePublicKeyFromPrivateKey(correctKey)
    );

    assert.deepEqual(
        Object.keys(encrypted),
        [
            "version",
            "ephemeralPublicKey",
            "iv",
            "authTag",
            "ciphertext"
        ]
    );
    assert.equal("student_id" in encrypted, false);
    assert.equal("rho" in encrypted, false);
    assert.deepEqual(
        decryptNoteWithStudentPrivateKey(
            encrypted,
            correctKey
        ),
        note
    );
    assert.throws(
        () => decryptNoteWithStudentPrivateKey(
            encrypted,
            wrongKey
        )
    );
});
