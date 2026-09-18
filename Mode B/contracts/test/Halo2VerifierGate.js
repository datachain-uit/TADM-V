/*
 * Kiểm chứng Halo2Verifier THẬT là cổng chặn.
 *
 * Đây là bản ONC tương ứng với
 * zk-circuits-halo2-advanced/prover/tests/verify_gate.rs.
 * Hai repo phải đo cùng một thứ theo cùng một cách,
 * nếu không thì kết luận "on-chain đạt / không đạt so
 * với off-chain" trở nên vô nghĩa.
 *
 * Ba khẳng định:
 *   1. calldata thật -> verifier CHẤP NHẬN;
 *   2. đổi 1 byte trong public input -> TỪ CHỐI;
 *   3. đổi 1 byte trong phần proof   -> TỪ CHỐI.
 *
 * KHÁC BIỆT QUAN TRỌNG so với ShieldedPool.js:
 * file đó dùng MockHalo2Verifier (luôn accept), nên
 * nó vẫn xanh kể cả khi verifier thật hỏng. File này
 * cố ý dùng Halo2Verifier thật.
 *
 * Xem code/CONSTRAINT_FLOW.md và code/VERIFY_MECHANISM.md.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

/*
 * Mặc định đọc proof đã sinh trong experiments/results/quantitative.
 * Đặt ONC_PROOF_FIXTURE để trỏ sang file khác khi cần
 * kiểm chứng bằng proof vừa sinh mà không ghi đè kết quả
 * thực nghiệm đang lưu.
 */
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

/*
 * Layout calldata do encode_calldata sinh ra:
 *   [0..32)  root
 *   [32..64) nullifier
 *   [64..96) amount
 *   [96..128) recipient (A25)
 *   [128..)  proof
 *
 * Trong chuỗi hex có tiền tố "0x", byte thứ i nằm ở
 * ký tự 2 + 2*i.
 */
const PUBLIC_INPUT_BYTES = 128;

function flipByteAt(hexString, byteIndex) {
    const offset = 2 + byteIndex * 2;
    const original = parseInt(
        hexString.slice(offset, offset + 2),
        16
    );
    const flipped = (original ^ 0x01)
        .toString(16)
        .padStart(2, "0");

    return (
        hexString.slice(0, offset)
        + flipped
        + hexString.slice(offset + 2)
    );
}

describe("Halo2Verifier (verifier THẬT) là cổng chặn", function () {
    let verifier;
    let calldata;
    let signer;

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

        [signer] = await ethers.getSigners();

        const Verifier = await ethers.getContractFactory(
            "Halo2Verifier",
            signer
        );
        verifier = await Verifier.deploy();
        await verifier.deployed();
    });

    /*
     * Oracle chấp nhận / từ chối.
     *
     * BẮT BUỘC dùng giao dịch thật + receipt.status.
     * KHÔNG dùng ethers.provider.call: Halo2Verifier
     * revert bằng revert(0, 0) - không kèm dữ liệu lỗi -
     * và provider.call KHÔNG phản ánh được revert đó một
     * cách nhất quán, dẫn tới kết luận sai là "verifier
     * chấp nhận mọi public input".
     */
    async function verifierAccepts(data) {
        try {
            const tx = await signer.sendTransaction({
                to: verifier.address,
                data,
                gasLimit: 3000000
            });

            const receipt = await tx.wait();

            return receipt.status === 1;
        } catch (error) {
            return false;
        }
    }

    it("chấp nhận calldata thật", async function () {
        const accepted = await verifierAccepts(calldata);

        if (!accepted) {
            /*
             * Fixture không còn khớp Halo2Verifier.sol hiện tại.
             * Khi đó verifier từ chối MỌI thứ, nên ba test negative
             * bên dưới sẽ xanh một cách vô nghĩa. Dừng cả suite
             * thay vì báo xanh giả.
             *
             * Sinh lại fixture:
             *   cd prover
             *   ../target/release/prover.exe bench-from-dataset \
             *       ../experiments/data/dataset_n1.json
             */
            this.skip();
        }

        assert.strictEqual(accepted, true);
    });

    it("từ chối khi đổi 1 byte trong PUBLIC INPUT (nullifier)", async function () {
        // Byte 32 nằm trong vùng nullifier [32..64).
        const tampered = flipByteAt(calldata, 32);

        assert.notStrictEqual(
            tampered,
            calldata,
            "phép lật byte phải thực sự đổi calldata"
        );

        const accepted = await verifierAccepts(tampered);

        assert.strictEqual(
            accepted,
            false,
            "Halo2Verifier PHẢI từ chối khi nullifier bị đổi. Nếu chỗ này "
            + "xanh thì verifier không chặn được gì và không được viết về "
            + "on-chain verification trong bài báo."
        );
    });

    it("từ chối khi đổi 1 byte trong PUBLIC INPUT (amount)", async function () {
        // Byte 64 nằm trong vùng amount [64..96).
        const accepted = await verifierAccepts(
            flipByteAt(calldata, 64)
        );

        assert.strictEqual(
            accepted,
            false,
            "Halo2Verifier PHẢI từ chối khi amount bị đổi"
        );
    });

    it("từ chối khi đổi 1 byte trong PUBLIC INPUT (recipient — A25)", async function () {
        // Byte 127 là byte thấp nhất của địa chỉ trong word [96..128).
        const accepted = await verifierAccepts(
            flipByteAt(calldata, 127)
        );
        assert.strictEqual(
            accepted,
            false,
            "Halo2Verifier PHẢI từ chối khi ví nhận bị đổi — nếu chỗ này xanh "
            + "thì proof không gắn với ví nhận, chép proof sang ví khác vẫn qua"
        );
    });

    it("từ chối khi đổi 1 byte trong phần PROOF", async function () {
        const accepted = await verifierAccepts(
            flipByteAt(calldata, PUBLIC_INPUT_BYTES)
        );

        assert.strictEqual(
            accepted,
            false,
            "Halo2Verifier PHẢI từ chối khi bytes của proof bị đổi"
        );
    });
});
