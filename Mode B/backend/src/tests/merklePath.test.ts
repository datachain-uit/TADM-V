/*
 * K10 — 03/09/2026
 *
 * Hai duong lay Merkle path phai cho ra CUNG mot proof:
 *   A. cu  — gui toan bo `commitments`, prover dung lai cay
 *   B. moi — gui `siblings`/`directions` doc tu cac nut da luu
 *
 * Test DOI CHUNG that su: no chay prover that. Neu ban port
 * trong utils/merklePath.ts lech quy uoc cua
 * `MerkleTree::get_path` (chi so anh em, o trong -> zeros,
 * thu tu bam trai/phai) thi root se khac va test do ngay.
 *
 * Ban sao cua test cung ten ben ADV — hai nhanh phai giu
 * cung mot quy uoc.
 *
 * Can `cargo build --release -p prover` truoc.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    runProver
} = require("../clients/prover/halo2ProverClient");

const {
    duongMerkleTuMang,
    duongMerkleTuNut
} = require("../utils/merklePath");

/*
 * Bon sinh vien la du: cay sau 9 tang nen 4 la de lai rat
 * nhieu o TRONG, tuc nhanh `zeros[level]` duoc di qua that
 * — do moi la cho de sai nhat.
 */
const SINH_VIEN = [
    { student_id: 24560000, amount: "2", rho: "11111111111111111111" },
    { student_id: 24560001, amount: "3", rho: "22222222222222222222" },
    { student_id: 24560002, amount: "5", rho: "33333333333333333333" },
    { student_id: 24560003, amount: "7", rho: "44444444444444444444" }
];

// A25 — vi nhan, public input thu 4. Hai duong phai cho cung proof voi cung vi.
const NGUOI_NHAN = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test(
    "duong Merkle doc san cho ra cung proof voi duong dung lai cay",
    () => {
        const commitments = SINH_VIEN.map(
            (sv: any) => runProver("commitment", sv).commitment
        );

        const cay = runProver("root", { commitments });

        assert.ok(
            Array.isArray(cay.nodes),
            "mode `root` phai tra ve `nodes`"
        );

        assert.ok(
            Array.isArray(cay.zeros),
            "mode `root` phai tra ve `zeros`"
        );

        assert.equal(
            cay.nodes.length,
            cay.zeros.length,
            "so tang phai bang so muc zeros"
        );

        for (let i = 0; i < SINH_VIEN.length; i += 1) {
            const base = {
                ...SINH_VIEN[i],
                merkle_index: i,
                expected_root: cay.root,
                recipient: NGUOI_NHAN
            };

            const cu = runProver("prove", { ...base, commitments });

            const duong = duongMerkleTuMang(i, cay.nodes, cay.zeros);

            const moi = runProver("prove", {
                ...base,
                commitments: [],
                ...duong
            });

            assert.equal(
                moi.root,
                cu.root,
                `root lech o merkle_index ${i}`
            );

            assert.equal(
                String(moi.root).toLowerCase(),
                String(cay.root).toLowerCase(),
                `root lech so voi mode \`root\` o index ${i}`
            );

            assert.equal(
                moi.nullifier,
                cu.nullifier,
                `nullifier lech o merkle_index ${i}`
            );

            assert.equal(
                moi.calldata.length,
                cu.calldata.length,
                `kich thuoc calldata lech o merkle_index ${i}`
            );
        }
    }
);

test(
    "o TRONG dung zeros[level], khong nhan doi nut trai",
    () => {
        /*
         * Cay 2 tang, chi co 1 la o index 0. Anh em cua no o
         * tang 0 la index 1 — KHONG co that — nen phai lay
         * zeros[0]. Nhan doi nut trai (kieu Bitcoin) la lo
         * hong CVE-2012-2459.
         */
        const nodes = [["0xaa"], ["0xbb"], ["0xcc"]];
        const zeros = ["0x00", "0x01", "0x02"];

        const duong = duongMerkleTuMang(0, nodes, zeros);

        assert.deepEqual(duong.siblings, ["0x00", "0x01"]);
        assert.deepEqual(duong.directions, [false, false]);
    }
);

test(
    "chi so anh em va huong khop get_path",
    () => {
        /*
         * index 5 = 101 nhi phan  ->  5 le (phai), 2 chan (trai),
         * 1 le (phai).
         */
        const duong = duongMerkleTuNut(
            5,
            3,
            ["0x00", "0x01", "0x02"],
            (level: number, index: number) =>
                "0x" + String(level) + String(index)
        );

        assert.deepEqual(duong.directions, [true, false, true]);
        assert.deepEqual(duong.siblings, ["0x04", "0x13", "0x20"]);
    }
);
