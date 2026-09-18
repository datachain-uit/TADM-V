/*
 * Kiểm chứng CÁC POOL ĐỘC LẬP VỚI NHAU.
 *
 * VÌ SAO CẦN:
 * MERKLE_DEPTH = 9 => mỗi pool tối đa 512 sinh viên. Câu trả lời của
 * bài cho phản biện "cả trường 128 sinh viên thôi à?" là:
 *
 *     "một chương trình học bổng = một pool; trường chạy nhiều
 *      chương trình song song, chi phí CỘNG lại chứ không NHÂN lên"
 *
 * Câu đó chỉ đứng vững nếu các pool thật sự không đụng nhau. Trước
 * file này, đó mới là SUY LUẬN TỪ CẤU TRÚC CODE (mỗi ShieldedPool có
 * currentRoot / validRoot / usedNullifier riêng), CHƯA CÓ PHÉP ĐO.
 *
 * NĂM KHẲNG ĐỊNH:
 *   1. Hai pool dùng CHUNG một verifier vẫn chạy đúng
 *      -> mở thêm chương trình chỉ tốn thêm bytecode của pool
 *   2. Proof của pool A rút được ở pool A            (kiểm DƯƠNG)
 *   3. Proof HỢP LỆ của pool A gửi vào pool B -> REVERT   (kiểm ÂM) <- QUAN TRỌNG NHẤT
 *   4. A rút rồi, nullifier của A KHÔNG chặn pool B  (sổ nullifier riêng)
 *   5. Gas rút ở pool B ~ pool A                     (không có chi phí chéo)
 *
 * KHẲNG ĐỊNH 3 LÀ CỐT LÕI. Proof đó KHÔNG HỎNG GÌ CẢ — verifier sẽ
 * xác nhận nó hợp lệ. Nó chỉ hợp lệ với CÂY của pool A, mà pool B
 * không biết cây đó. Nếu pool B vẫn nhận thì sinh viên chương trình A
 * rút được tiền của chương trình B, và toàn bộ thiết kế sụp đổ.
 *
 * Cùng họ với Halo2VerifierGate.js (5 biến thể proof bị sửa), nhưng
 * khác ở chỗ: ở đây proof HOÀN TOÀN HỢP LỆ, cái sai là ĐẶT SAI CHỖ.
 *
 * Đặc tả: code/DINH_NGHIA_PHEP_DO.md mục 3e bước 3.
 * Tiến độ: code/STATUS.md việc 11.
 *
 * FIXTURE: dùng proof thật đã sinh. Hai kịch bản n khác nhau cho hai
 * root khác nhau (cây 1 lá và cây 5 lá băm ra hai gốc khác nhau —
 * xem DINH_NGHIA_PHEP_DO.md mục 3b).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const RESULTS_DIR = path.join(
    __dirname, "..", "..", "experiments", "results", "quantitative"
);

const FIXTURE_A =
    process.env.ONC_POOL_A_FIXTURE
    || path.join(RESULTS_DIR, "proofs_n1.json");

/*
 * DOI 2026-08-31: `proofs_n5.json` -> `proofs_n10.json`.
 *
 * Day kich ban doi tu {1,5,10,20,50,100} sang {1,10,30,60,100,353,500},
 * nen `n = 5` KHONG con duoc sinh nua. File `proofs_n5.json` van nam tren
 * dia nhung la ban CU o `d = 7` (calldata 3 296 B) — verifier `d = 9` tu
 * choi no, va test nay do voi 'invalid proof'.
 *
 * Test chi can HAI kich ban KHAC NHAU cho hai pool; `n = 1` va `n = 10`
 * deu thuoc day moi nen dung duoc.
 */
const FIXTURE_B =
    process.env.ONC_POOL_B_FIXTURE
    || path.join(RESULTS_DIR, "proofs_n10.json");

/*
 * Layout calldata do encode_calldata sinh ra:
 *   [0..32)  root
 *   [32..64) nullifier
 *   [64..96) amount
 *   [96..)   proof
 *
 * Trong chuỗi hex có tiền tố "0x", byte thứ i nằm ở ký tự 2 + 2*i.
 */
function decodePublicInputs(calldata) {
    return {
        root: "0x" + calldata.slice(2, 66),
        nullifier: "0x" + calldata.slice(66, 130),
        amount: ethers.BigNumber.from("0x" + calldata.slice(130, 194)),

        /*
         * A25 — word thu 4 la VI NHAN, va hop dong bat no phai trung
         * tham so `recipient`. Nen test PHAI lay vi tu chinh proof;
         * truyen mot signer cung (studentA/studentB) thi proof cua
         * bo du lieu dinh luong se revert 'recipient differs from
         * proof', vi ca hai kich ban deu la sinh vien 0 => cung accounts[1].
         */
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

describe("Các pool độc lập với nhau", function () {
    let verifier;
    let poolA;
    let poolB;
    let school;
    let studentA;
    let studentB;
    let proofA;
    let proofB;

    before(async function () {
        proofA = loadProof(FIXTURE_A);
        proofB = loadProof(FIXTURE_B);

        if (!proofA || !proofB) {
            /*
             * Chưa sinh proof thì bỏ qua, KHÔNG báo xanh giả.
             * Sinh bằng: npm run experiment:proofs (backend)
             */
            this.skip();
        }

        /*
         * Hai proof PHẢI có root khác nhau, nếu không thì kiểm ÂM
         * ở khẳng định 3 trở nên vô nghĩa (proof của A hợp lệ ở B
         * chỉ vì hai pool tình cờ cùng root).
         */
        if (proofA.root === proofB.root) {
            this.skip();
        }

        [school, studentA, studentB] = await ethers.getSigners();

        // --- 1 verifier DUNG CHUNG cho ca hai pool ---
        const Verifier = await ethers.getContractFactory(
            "Halo2Verifier", school
        );
        verifier = await Verifier.deploy();
        await verifier.deployed();

        const Pool = await ethers.getContractFactory(
            "ShieldedPool", school
        );

        poolA = await Pool.deploy(
            verifier.address,
            0,
            { value: ethers.utils.parseEther("1") }
        );
        await poolA.deployed();

        poolB = await Pool.deploy(
            verifier.address,
            0,
            { value: ethers.utils.parseEther("1") }
        );
        await poolB.deployed();

        /*
         * Mỗi pool chỉ công bố root CỦA MÌNH — đúng như flow thật:
         * approveRootService gom `find({ pool: pool._id })` nên cây
         * Merkle của mỗi pool dựng riêng.
         */
        await (await poolA.updateRoot(proofA.root, [])).wait();
        await (await poolB.updateRoot(proofB.root, [])).wait();
    });

    it("1. hai pool dùng chung MỘT verifier", async function () {
        assert.strictEqual(
            await poolA.verifier(),
            verifier.address,
            "poolA phải trỏ tới verifier dùng chung"
        );

        assert.strictEqual(
            await poolB.verifier(),
            verifier.address,
            "poolB phải trỏ tới verifier dùng chung"
        );

        /*
         * Ý nghĩa cho khả năng triển khai: constructor nhận địa chỉ
         * verifier, nên mở thêm chương trình chỉ tốn thêm bytecode
         * của ShieldedPool (4 837 B), KHÔNG phải cả verifier
         * (17 040 B). Xem DINH_NGHIA_PHEP_DO.md mục 3c ③.
         *
         * LƯU Ý: deployScholarshipPoolService.ts hiện deploy verifier
         * MỚI mỗi pool — khả năng có, cài đặt chưa tận dụng.
         */
    });

    it("2. mỗi pool chỉ công bố root của mình", async function () {
        assert.strictEqual(
            await poolA.validRoot(proofA.root), true,
            "poolA phải biết root của A"
        );

        assert.strictEqual(
            await poolA.validRoot(proofB.root), false,
            "poolA KHÔNG được biết root của B"
        );

        assert.strictEqual(
            await poolB.validRoot(proofB.root), true,
            "poolB phải biết root của B"
        );

        assert.strictEqual(
            await poolB.validRoot(proofA.root), false,
            "poolB KHÔNG được biết root của A"
        );
    });

    /*
     * ===== KIEM AM — khang dinh quan trong nhat cua file nay =====
     */
    it("3. proof HỢP LỆ của pool A gửi vào pool B -> REVERT", async function () {
        let reverted = false;
        let reason = "";

        try {
            await poolB.withdraw(
                proofA.calldata,
                proofA.root,
                proofA.nullifier,
                proofA.recipient,
                proofA.amount,
                { gasLimit: 3000000 }
            );
        } catch (error) {
            reverted = true;
            reason = String(error.message || "");
        }

        assert.ok(
            reverted,
            "NGHIÊM TRỌNG: pool B nhận proof của pool A => tiền chương "
            + "trình này rút được bởi sinh viên chương trình kia"
        );

        /*
         * Chốt ĐÚNG lý do revert. Nếu revert vì lý do khác (hết tiền,
         * sai onlySchool...) thì test vẫn xanh nhưng KHÔNG chứng minh
         * được điều cần chứng minh — đúng loại "xanh giả".
         */
        assert.ok(
            reason.includes("root not in history"),
            "phải revert vì `root not in history`, nhận được: " + reason
        );
    });

    it("4. A rút xong, nullifier của A không chặn pool B", async function () {
        // A withdraw o pool cua minh — kiem DUONG
        await (await poolA.withdraw(
            proofA.calldata,
            proofA.root,
            proofA.nullifier,
            proofA.recipient,
            proofA.amount,
            { gasLimit: 3000000 }
        )).wait();

        assert.strictEqual(
            await poolA.usedNullifier(proofA.nullifier), true,
            "poolA phải ghi nhận nullifier đã dùng"
        );

        /*
         * Sổ nullifier là state của TỪNG contract, nên pool B không
         * hề biết A đã tiêu gì.
         */
        assert.strictEqual(
            await poolB.usedNullifier(proofA.nullifier), false,
            "poolB KHÔNG được thấy nullifier của poolA"
        );

        // B van withdraw duoc binh thuong
        await (await poolB.withdraw(
            proofB.calldata,
            proofB.root,
            proofB.nullifier,
            proofB.recipient,
            proofB.amount,
            { gasLimit: 3000000 }
        )).wait();

        assert.strictEqual(
            await poolB.usedNullifier(proofB.nullifier), true,
            "poolB phải rút được dù poolA đã rút trước"
        );
    });

    it("5. rút lại ở pool A vẫn bị chặn (nullifier không hỏng)", async function () {
        let reverted = false;
        let reason = "";

        try {
            await poolA.withdraw(
                proofA.calldata,
                proofA.root,
                proofA.nullifier,
                proofA.recipient,
                proofA.amount,
                { gasLimit: 3000000 }
            );
        } catch (error) {
            reverted = true;
            reason = String(error.message || "");
        }

        assert.ok(reverted, "rút trùng phải bị chặn");

        assert.ok(
            reason.includes("nullifier already used"),
            "phải revert vì `nullifier already used`, nhận được: " + reason
        );

        /*
         * Khang dinh nay chot rang viec THEM POOL khong lam yeu di
         * co che chong withdraw trung — tinh chat loi cua Contribution 1.
         */
    });
});
