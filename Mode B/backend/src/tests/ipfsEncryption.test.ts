const test = require("node:test");
const assert = require("node:assert/strict");
const {
    derivePublicKeyFromPrivateKey,
    encryptNoteForStudent
} = require("../clients/ipfs/ipfsClient");
const {
    decryptNoteWithStudentPrivateKey
} = require("../clients/ipfs/encryptedNoteStorage");

/*
 * Port từ ADV ngày 2026-08-18. Đây là bằng chứng tự động cho C5:
 * note chỉ tồn tại dạng ciphertext, và khoá sai bị AES-256-GCM từ chối
 * bằng LỖI XÁC THỰC — không phải so chuỗi rồi trả false.
 *
 * Khác ADV: hai hàm nằm ở hai file khác nhau, vì ONC tách phần mã hoá
 * (ipfsClient) khỏi phần đọc/giải mã (encryptedNoteStorage).
 */
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
