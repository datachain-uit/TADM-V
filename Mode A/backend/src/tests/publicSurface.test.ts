const test = require("node:test");
const assert = require("node:assert/strict");
const artifact = require(
    "../../../contracts/artifacts/" +
    "contracts/ShieldedPool.sol/ShieldedPool.json"
);
const {
    privateWitnessLeakageCheck
} = require("../experiments/publicSurfaceAudit");

test("withdraw calldata and events exclude private witnesses", () => {
    const withdraw = artifact.abi.find(
        (item: any) =>
            item.type === "function"
            && item.name === "withdrawOffChain"
    );
    const serializedPublicSurface = JSON.stringify(artifact.abi);

    assert.deepEqual(
        withdraw.inputs.map((input: any) => input.name),
        ["root", "nullifier", "recipient", "amount"]
    );

    for (const privateName of [
        "student_id",
        "rho",
        "siblings",
        "directions"
    ]) {
        assert.equal(
            serializedPublicSurface.includes(privateName),
            false
        );
    }
});

test("qualitative artifact audit detects private field names", () => {
    const clean = privateWitnessLeakageCheck({
        proofOutput: {
            root: "0x01",
            nullifier: "0x02",
            amount: "10"
        }
    });

    assert.equal(clean.passed, true);
    assert.deepEqual(clean.exposedNames, []);

    const leaked = privateWitnessLeakageCheck({ rho: "private" });

    assert.equal(leaked.passed, false);
    assert.deepEqual(leaked.exposedNames, ["rho"]);
});

test("audit detects a private VALUE hidden under an innocent name", () => {
    // Ro ri kieu nay la thu ban cu KHONG bat duoc: gia tri `rho` bi
    // day vao mot truong ten vo hai (gioi han L2 trong 00_contributions.md).
    const rho =
        "8123456789012345678901234567890123456789012345678901234567890123";
    const audit = privateWitnessLeakageCheck(
        { proofOutput: { memo: rho } },
        { rho }
    );

    assert.equal(audit.passed, false);
    assert.deepEqual(audit.exposedNames, []);
    assert.equal(audit.exposedValues.length > 0, true);
    assert.equal(audit.exposedValues[0].label, "rho");
});

test("audit finds a private value written in a different encoding", () => {
    // Gia tri thap phan, nhung artifact ghi dang hex 32 byte.
    const rhoDecimal = "123456789012345678901234567890";
    const asPaddedHex = "0x" + BigInt(rhoDecimal)
        .toString(16)
        .padStart(64, "0");
    const audit = privateWitnessLeakageCheck(
        { events: [{ data: asPaddedHex }] },
        { rho: rhoDecimal }
    );

    assert.equal(audit.passed, false);
    assert.equal(audit.exposedValues.length > 0, true);
});

test("audit reports what it could NOT check", () => {
    // Gia tri qua ngan thi bo qua, va phai NOI RO da bo qua.
    const audit = privateWitnessLeakageCheck(
        { proofOutput: { root: "0xabcdef0123456789" } },
        { student_id: 1 }
    );

    assert.equal(audit.coverage.skippedTooShort.length > 0, true);
    assert.equal(
        audit.coverage.skippedTooShort.every(
            (item: any) => item.label === "student_id"
        ),
        true
    );
});
