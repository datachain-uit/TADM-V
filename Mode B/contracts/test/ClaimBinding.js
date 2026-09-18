/*
 * Kiểm chứng RÀNG BUỘC CỦA `Claim` — thiết kế tách xác minh khỏi thanh toán.
 *
 * VÌ SAO CẦN:
 * `withdraw` gộp xác minh và thanh toán vào MỘT giao dịch, nên việc
 * "verify chứng minh điều gì" và "thanh toán chi cho ai" được buộc với
 * nhau một cách TỰ NHIÊN — không thể lệch.
 *
 * Tách thành `verifyAndRecord` + `settle` thì mối buộc đó phải TỰ LÀM,
 * bằng cách ghi đủ root/amount/recipient vào `Claim`. Đây là BỀ MẶT TẤN
 * CÔNG MỚI mà thiết kế gộp không có.
 *
 * KỊCH BẢN TẤN CÔNG nếu làm sai (chỉ lưu một bit "đã verify"):
 *
 *     verifyAndRecord(proof_that, root, N, recipient=An, amount=2)
 *         -> verified[N] = true
 *     settle(N, recipient=KeTanCong, amount=1000000000)
 *         -> require(verified[N]) PASS  ->  chi tien cho ke tan cong
 *
 * Verify chứng minh một chuyện, thanh toán làm chuyện khác.
 *
 * HAI LỚP CHẶN trong cài đặt hiện tại:
 *   1. `Claim` lưu ĐỦ root + amount + recipient
 *   2. `settle` CHỈ nhận `nullifier` — mọi giá trị khác đọc từ storage
 *
 * Lớp 2 là chặn ở mức CHỮ KÝ HÀM: không có tham số nào để truyền sai.
 *
 * SÁU KHẲNG ĐỊNH:
 *   1. Luồng thuận: verifyAndRecord -> settle -> tiền tới ĐÚNG người, ĐÚNG số
 *   2. settle khi CHƯA verifyAndRecord            -> revert  (kiểm ÂM)
 *   3. verifyAndRecord HAI LẦN cùng nullifier     -> revert  (kiểm ÂM) <- QUAN TRỌNG NHẤT
 *   4. settle HAI LẦN                             -> revert  (kiểm ÂM)
 *   5. Tham số lệch public input trong proof       -> revert  (kiểm ÂM)
 *   6. settle bởi người KHÔNG phải school          -> revert  (kiểm ÂM)
 *
 * KHẲNG ĐỊNH 3 LÀ CỐT LÕI. Ghi đè được `Claim` nghĩa là kẻ tấn công
 * verify một proof hợp lệ rồi gọi lại chính nó với `recipient` là ví của
 * mình — `settle` sau đó chi tiền cho hắn.
 *
 * Đặc tả: code/DINH_NGHIA_PHEP_DO.md · code/STATUS.md
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const RESULTS_DIR = path.join(
    __dirname, "..", "..", "experiments", "results", "quantitative"
);

const FIXTURE =
    process.env.ONC_PROOF_FIXTURE
    || path.join(RESULTS_DIR, "proofs_n1.json");

/*
 * Layout calldata: [0..32) root · [32..64) nullifier · [64..96) amount
 *                  · [96..128) recipient (A25 — word 32 byte dem trai)
 * Trong chuỗi hex có "0x", byte thứ i nằm ở ký tự 2 + 2*i.
 */
function decodePublicInputs(calldata) {
    return {
        root: "0x" + calldata.slice(2, 66),
        nullifier: "0x" + calldata.slice(66, 130),
        amount: ethers.BigNumber.from("0x" + calldata.slice(130, 194)),
        // A25 — 20 byte cuoi cua word thu 4.
        recipient: ethers.utils.getAddress("0x" + calldata.slice(218, 258))
    };
}

function loadProof(fixture) {
    if (!fs.existsSync(fixture)) {
        return null;
    }

    const records = JSON.parse(fs.readFileSync(fixture, "utf8"));
    const record = Array.isArray(records) ? records[0] : records;

    if (!record || typeof record.calldata !== "string") {
        return null;
    }

    return {
        calldata: record.calldata,
        ...decodePublicInputs(record.calldata)
    };
}

async function expectRevert(promise, expectedReason) {
    let reverted = false;
    let reason = "";

    try {
        await promise;
    } catch (error) {
        reverted = true;
        reason = String(error.message || "");
    }

    assert.ok(
        reverted,
        `Đáng lẽ phải revert với "${expectedReason}" nhưng lại THÀNH CÔNG`
    );

    assert.ok(
        reason.includes(expectedReason),
        `Phải revert vì "${expectedReason}", nhận được: ${reason}`
    );
}

describe("Claim binding — tách xác minh khỏi thanh toán", function () {
    let verifier;
    let pool;
    let school;
    let student;
    let attacker;
    let proof;

    beforeEach(async function () {
        proof = loadProof(FIXTURE);

        if (!proof) {
            /*
             * Chưa sinh proof thì bỏ qua, KHÔNG báo xanh giả.
             * Sinh bằng: npm run experiment:proofs (backend)
             */
            this.skip();
        }

        [school, student, attacker] = await ethers.getSigners();

        const Verifier = await ethers.getContractFactory(
            "Halo2Verifier", school
        );
        verifier = await Verifier.deploy();
        await verifier.deployed();

        const Pool = await ethers.getContractFactory("ShieldedPool", school);
        pool = await Pool.deploy(
            verifier.address,
            0,
            { value: ethers.utils.parseEther("1") }
        );
        await pool.deployed();

        await (await pool.updateRoot(proof.root, [])).wait();
    });

    // =====================================================
    // 1 — LUONG THUAN
    // =====================================================

    it("1. verifyAndRecord -> settle: tiền tới ĐÚNG người, ĐÚNG số", async function () {
        await (await pool.verifyAndRecord(
            proof.calldata,
            proof.root,
            proof.nullifier,
            student.address,
            proof.amount,
            { gasLimit: 3000000 }
        )).wait();

        const claim = await pool.claims(proof.nullifier);

        assert.strictEqual(claim.verified, true, "Claim phải được ghi");
        assert.strictEqual(
            claim.recipient, student.address,
            "Claim phải nhớ ĐÚNG recipient"
        );
        assert.ok(
            claim.amount.eq(proof.amount),
            "Claim phải nhớ ĐÚNG amount"
        );
        assert.strictEqual(
            claim.root, proof.root,
            "Claim phải nhớ ĐÚNG root"
        );

        const before = await ethers.provider.getBalance(student.address);

        await (await pool.settle(proof.nullifier, { gasLimit: 3000000 })).wait();

        const after = await ethers.provider.getBalance(student.address);

        assert.ok(
            after.sub(before).eq(proof.amount),
            "Sinh viên phải nhận ĐÚNG số tiền đã được chứng minh"
        );

        assert.strictEqual(
            await pool.usedNullifier(proof.nullifier), true,
            "Nullifier phải được đánh dấu"
        );
    });

    // =====================================================
    // 2 — KIEM AM: settle khi chua verify
    // =====================================================

    it("2. settle khi CHƯA verifyAndRecord -> revert", async function () {
        await expectRevert(
            pool.settle(proof.nullifier, { gasLimit: 3000000 }),
            "claim not verified"
        );
    });

    // =====================================================
    // 3 — KIEM AM COT LOI: ghi de Claim
    // =====================================================

    it("3. 🔴 verifyAndRecord HAI LẦN cùng nullifier -> revert (chặn ghi đè recipient)", async function () {
        // Lan 1 — hop le, cho sinh vien
        await (await pool.verifyAndRecord(
            proof.calldata,
            proof.root,
            proof.nullifier,
            student.address,
            proof.amount,
            { gasLimit: 3000000 }
        )).wait();

        /*
         * Lan 2 — CUNG proof hop le do, nhung doi recipient sang ke
         * tan cong. Neu ghi de duoc thi `settle` sau do chi tien cho
         * han, du proof chung minh cho sinh vien.
         */
        // A25 — ke tan cong KHONG goi duoc: verifyAndRecord chi nha truong.
        await expectRevert(
            pool.connect(attacker).verifyAndRecord(
                proof.calldata,
                proof.root,
                proof.nullifier,
                attacker.address,
                proof.amount,
                { gasLimit: 3000000 }
            ),
            "not school"
        );

        // A25 — ngay ca nha truong cung KHONG doi duoc vi nhan trong proof.
        await expectRevert(
            pool.verifyAndRecord(
                proof.calldata,
                proof.root,
                proof.nullifier,
                attacker.address,
                proof.amount,
                { gasLimit: 3000000 }
            ),
            "recipient differs from proof"
        );

        // Gui lai DUNG ban ghi cu -> chan ghi de.
        await expectRevert(
            pool.verifyAndRecord(
                proof.calldata,
                proof.root,
                proof.nullifier,
                student.address,
                proof.amount,
                { gasLimit: 3000000 }
            ),
            "claim already recorded"
        );

        // Ban ghi phai VAN la sinh vien
        const claim = await pool.claims(proof.nullifier);
        assert.strictEqual(
            claim.recipient, student.address,
            "NGHIÊM TRỌNG: recipient trong Claim đã bị ghi đè"
        );
    });

    // =====================================================
    // 4 — KIEM AM: settle hai lan
    // =====================================================

    it("4. settle HAI LẦN -> revert", async function () {
        await (await pool.verifyAndRecord(
            proof.calldata,
            proof.root,
            proof.nullifier,
            student.address,
            proof.amount,
            { gasLimit: 3000000 }
        )).wait();

        await (await pool.settle(proof.nullifier, { gasLimit: 3000000 })).wait();

        await expectRevert(
            pool.settle(proof.nullifier, { gasLimit: 3000000 }),
            "nullifier already used"
        );
    });

    // =====================================================
    // 5 — KIEM AM: tham so lech public input trong proof
    // =====================================================

    it("5. amount lệch public input trong proof -> revert", async function () {
        await expectRevert(
            pool.verifyAndRecord(
                proof.calldata,
                proof.root,
                proof.nullifier,
                student.address,
                proof.amount.add(1),        // <- lech 1 wei
                { gasLimit: 3000000 }
            ),
            "amount differs from proof"
        );
    });

    // =====================================================
    // 6 — KIEM AM: settle boi nguoi khong phai school
    // =====================================================

    it("6. settle bởi người KHÔNG phải school -> revert", async function () {
        await (await pool.verifyAndRecord(
            proof.calldata,
            proof.root,
            proof.nullifier,
            student.address,
            proof.amount,
            { gasLimit: 3000000 }
        )).wait();

        await expectRevert(
            pool.connect(attacker).settle(
                proof.nullifier,
                { gasLimit: 3000000 }
            ),
            "not school"
        );
    });

    // =====================================================
    // 7 — CHU KY HAM: settle KHONG NHAN gi ngoai nullifier
    // =====================================================

    it("7. `settle` chỉ nhận nullifier — không có tham số nào để truyền sai", function () {
        const fragment = pool.interface.getFunction("settle");

        assert.strictEqual(
            fragment.inputs.length, 1,
            "settle phải nhận ĐÚNG MỘT tham số"
        );

        assert.strictEqual(
            fragment.inputs[0].type, "bytes32",
            "Tham số duy nhất phải là nullifier (bytes32)"
        );

        /*
         * Day la lop chan MANH NHAT: khong phai kiem tra luc chay ma la
         * tinh chat cua CHU KY HAM. Khong ton tai tham so `recipient`
         * hay `amount` de ke tan cong truyen sai.
         */
    });

    // =====================================================
    // 8 — A25: CHAY TRUOC (front-running)
    // =====================================================
    //
    // Kich ban that tren mang co mempool cong khai: ke tan cong doc
    // giao dich verifyAndRecord cua nha truong, chep proof, gui TRUOC
    // voi vi cua han. Truoc A25 ban ghi cua han thang, va chinh
    // `require(!claims[nullifier].verified)` bao ve ban ghi do.

    it("8. 🔴 A25 — kẻ tấn công gửi TRƯỚC nhà trường -> bị chặn, tiền vẫn về đúng sinh viên", async function () {
        assert.strictEqual(
            proof.recipient, student.address,
            "fixture phai gan dung vi sinh vien — sinh lai proof voi recipient nay"
        );

        await expectRevert(
            pool.connect(attacker).verifyAndRecord(
                proof.calldata,
                proof.root,
                proof.nullifier,
                attacker.address,
                proof.amount,
                { gasLimit: 3000000 }
            ),
            "not school"
        );

        const trong = await pool.claims(proof.nullifier);
        assert.strictEqual(
            trong.verified, false,
            "NGHIEM TRONG: ke tan cong da ghi duoc Claim"
        );

        // Nha truong ghi sau — van thanh cong, dung vi sinh vien.
        await (await pool.verifyAndRecord(
            proof.calldata,
            proof.root,
            proof.nullifier,
            student.address,
            proof.amount,
            { gasLimit: 3000000 }
        )).wait();

        const claim = await pool.claims(proof.nullifier);
        assert.strictEqual(claim.recipient, student.address);

        const before = await ethers.provider.getBalance(student.address);
        await (await pool.settle(proof.nullifier, { gasLimit: 3000000 })).wait();
        const after = await ethers.provider.getBalance(student.address);
        assert.ok(after.sub(before).eq(proof.amount), "tien phai ve dung sinh vien");
    });

    // =====================================================
    // 9 — A25: proof hop le, vi nhan lech proof
    // =====================================================

    it("9. 🔴 A25 — proof hợp lệ nhưng ví nhận lệch ví trong proof -> revert, kể cả nhà trường", async function () {
        await expectRevert(
            pool.verifyAndRecord(
                proof.calldata,
                proof.root,
                proof.nullifier,
                attacker.address,
                proof.amount,
                { gasLimit: 3000000 }
            ),
            "recipient differs from proof"
        );

        const trong = await pool.claims(proof.nullifier);
        assert.strictEqual(trong.verified, false, "khong duoc ghi Claim nao");
    });
});
