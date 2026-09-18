const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
    getProverPath,
    runRust
} = require("../clients/prover/halo2ProverClient");

test("prover client resolves the binary and computes a real commitment", () => {
    assert.equal(fs.existsSync(getProverPath()), true);

    const output = runRust("commitment", {
        student_id: 1,
        amount: "1000",
        rho: "123"
    });

    assert.equal(
        output.commitment,
        "0x324532af9c6dc0a464517dc959ed81e157593968354dab854e31442b336f1f0a"
    );
});
