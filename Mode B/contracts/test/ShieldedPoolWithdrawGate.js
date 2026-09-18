/*
 * C-11 — kiểm ba `require` của ShieldedPool.withdraw ràng buộc
 * tham số hàm với public input nằm trong calldata.
 *
 *   require(root      == proofRoot,      "root differs from proof")
 *   require(nullifier == proofNullifier, "nullifier differs from proof")
 *   require(amount    == proofAmount,    "amount differs from proof")
 *
 * Ba dòng này CHƯA TỪNG được test. Chúng là thứ ngăn University
 * gửi một proof hợp lệ nhưng khai số tiền / người nhận khác với
 * thứ proof thật sự chứng minh.
 *
 * KHÁC ShieldedPool.js: file đó deploy MockHalo2Verifier (luôn
 * accept) nên vẫn xanh dù verifier thật hỏng. File này deploy
 * Halo2Verifier THẬT và dùng proof thật.
 *
 * Xem code/STATUS.md mục C-11 và code/CONSTRAINT_FLOW.md mục 7b.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const PROOF_FIXTURE =
    process.env.ONC_PROOF_FIXTURE
    || path.join(
        __dirname,
        "..",
        "..",
        "experiments",
        "results",
        "quantitative",
        "proofs_n1.json"
    );

/* Layout calldata: [0..32) root · [32..64) nullifier · [64..96) amount · [96..128) recipient (A25) */
function publicInputsFrom(calldata) {
    const body = calldata.replace(/^0x/, "");

    return {
        root: "0x" + body.slice(0, 64),
        nullifier: "0x" + body.slice(64, 128),
        amount: BigInt("0x" + body.slice(128, 192))
    };
}

function bumpWord(word) {
    return "0x" + (BigInt(word) + 1n)
        .toString(16)
        .padStart(64, "0");
}

async function expectRevert(action, message) {
    try {
        await action();
        assert.fail(
            `Giao dịch PHẢI revert với "${message}" nhưng lại thành công`
        );
    } catch (error) {
        assert.match(
            String(error.message),
            new RegExp(message),
            `Revert sai lý do. Mong đợi "${message}", nhận: ${error.message}`
        );
    }
}

describe("ShieldedPool.withdraw — ba require ràng buộc tham số với proof", function () {
    let pool;
    let university;
    let student;
    let calldata;
    let pub;

    before(async function () {
        if (!fs.existsSync(PROOF_FIXTURE)) {
            this.skip();
        }

        const proofs = JSON.parse(
            fs.readFileSync(PROOF_FIXTURE, "utf8")
        );
        const record = Array.isArray(proofs) ? proofs[0] : proofs;

        if (!record || typeof record.calldata !== "string") {
            this.skip();
        }

        calldata = record.calldata;
        pub = publicInputsFrom(calldata);

        [university, student] = await ethers.getSigners();

        const verifier = await (
            await ethers.getContractFactory("Halo2Verifier", university)
        ).deploy();
        await verifier.deployed();

        pool = await (
            await ethers.getContractFactory("ShieldedPool", university)
        ).deploy(verifier.address, 0, {
            value: ethers.utils.parseEther("10")
        });
        await pool.deployed();

        // Nhà trường duyệt đúng root nằm trong proof.
        await (await pool.updateRoot(pub.root, [])).wait();
    });

    it("chấp nhận khi ba tham số khớp public input trong proof", async function () {
        const before = await ethers.provider.getBalance(student.address);

        await (
            await pool.withdraw(
                calldata,
                pub.root,
                pub.nullifier,
                student.address,
                pub.amount
            )
        ).wait();

        const after = await ethers.provider.getBalance(student.address);

        assert.strictEqual(
            after.sub(before).toString(),
            pub.amount.toString(),
            "sinh viên phải nhận đúng số tiền ràng buộc trong proof"
        );
    });

    it("revert khi ROOT khác public input trong proof", async function () {
        await expectRevert(
            () => pool.withdraw(
                calldata,
                bumpWord(pub.root),     // ← lệch
                pub.nullifier,
                student.address,
                pub.amount
            ),
            "root differs from proof"
        );
    });

    it("revert khi NULLIFIER khác public input trong proof", async function () {
        await expectRevert(
            () => pool.withdraw(
                calldata,
                pub.root,
                bumpWord(pub.nullifier),    // ← lệch
                student.address,
                pub.amount
            ),
            "nullifier differs from proof"
        );
    });

    it("revert khi AMOUNT khác public input trong proof", async function () {
        await expectRevert(
            () => pool.withdraw(
                calldata,
                pub.root,
                pub.nullifier,
                student.address,
                pub.amount + 1n            // ← lệch: University đòi nhiều hơn
            ),
            "amount differs from proof"
        );
    });

    it("revert khi RECIPIENT khác ví ghi trong proof (A25 — chép proof sang ví khác)", async function () {
        await expectRevert(
            () => pool.withdraw(
                calldata,
                pub.root,
                pub.nullifier,
                university.address,         // ← lệch: không phải ví trong proof
                pub.amount
            ),
            "recipient differs from proof"
        );
    });

    it("revert khi root chưa được nhà trường duyệt (validRoot)", async function () {
        const otherVerifier = await (
            await ethers.getContractFactory("Halo2Verifier", university)
        ).deploy();
        await otherVerifier.deployed();

        const freshPool = await (
            await ethers.getContractFactory("ShieldedPool", university)
        ).deploy(otherVerifier.address, 0, {
            value: ethers.utils.parseEther("10")
        });
        await freshPool.deployed();

        /*
         * Pool mới chưa gọi updateRoot, nên root của proof không
         * nằm trong lịch sử. Đây là NEO TRẠNG THÁI — verifier một
         * mình không phát hiện được, vì proof vẫn hợp lệ về mật mã.
         */
        await expectRevert(
            () => freshPool.withdraw(
                calldata,
                pub.root,
                pub.nullifier,
                student.address,
                pub.amount
            ),
            "root not in history"
        );
    });
});
