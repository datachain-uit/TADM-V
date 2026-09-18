const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
    proverBinary,
    runProver
} = require("../clients/prover/halo2ProverClient");

/*
 * Port từ ADV ngày 2026-08-18.
 *
 * Chốt chặn cho "backend và prover Rust còn nói cùng một ngôn ngữ": nếu ai
 * đổi công thức Poseidon, MERKLE_DEPTH, hay cách nối trường trong
 * commitment thì test này đỏ ngay, không đợi tới lúc chạy full flow.
 *
 * ⚠️ Commitment kỳ vọng KHÁC nhánh ADV vì hai nhánh dùng hai đường cong
 * khác nhau (BN254 vs pasta/vesta). Đừng "sửa" cho hai bên bằng nhau.
 *   ADV: 0x324532af9c6dc0a464517dc959ed81e157593968354dab854e31442b336f1f0a
 *   ONC: 0x1033045e6936e742c6bc862619ad3a1a00b2c0ef705b7657db12088969b01c02
 */
test("prover client resolves the binary and computes a real commitment", () => {
    assert.equal(fs.existsSync(proverBinary()), true);

    const output = runProver("commitment", {
        student_id: 1,
        amount: "1000",
        rho: "123"
    });

    assert.equal(
        output.commitment,
        "0x1033045e6936e742c6bc862619ad3a1a00b2c0ef705b7657db12088969b01c02"
    );
});
