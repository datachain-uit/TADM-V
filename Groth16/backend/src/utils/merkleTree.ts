// =============================================================================
// MERKLE TREE — bản JS sao chép MerkleTree của mạch Halo2
//
// Nguồn: zk-halo2-onchain/circuits/src/merkle_tree.rs
//   - empty_subtree_roots (dòng 211) — bảng zeros[]
//   - insert              (dòng 265) — ô trống lấy zeros[level]
//   - get_path            (dòng 471) — sibling ngoài biên lấy zeros[level]
//   - root                          — nodes[depth][0]
//
// Phải sao y HÌNH DẠNG cây. Sai chỗ này thì root khác, proof khác, phép so hỏng.
//
// 🔴 A18 — 2026-08-28: ĐỔI QUY ƯỚC ĐỆM Ô TRỐNG
//
//   TRƯỚC: ô trống = NHÂN ĐÔI nút trái  (kiểu Bitcoin)
//   NAY:   ô trống = zeros[level]       (kiểu Tornado Cash / Semaphore / Zcash)
//
//   Vì sao đổi — quy ước nhân đôi làm ROOT KHÔNG XÁC ĐỊNH DUY NHẤT tập lá:
//   [a,b,c] và [a,b,c,c] cho CÙNG một root, vì cả hai đều ra tầng 1 =
//   [H(a,b), H(c,c)]. Đó là CVE-2012-2459 của Bitcoin.
//
//   Bảng zeros:  zeros[0] = 0
//                zeros[l+1] = H(zeros[l], zeros[l])
//
// 🔴 d = 7 -> 9 (2026-08-30): hai nhánh chính sang 512 lá vì UIT cấp 353 suất
//   HBKKHT HK1 2025-26 (QĐ 653/QĐ-ĐHCNTT) — 353 > 256 nên d = 8 không đủ.
//
// ⚠️ Hàm băm thì KHÔNG giống: bên kia là halo2_base sponge rate 2, bên này là
//    circomlib Poseidon(2) bề rộng cố định. Xem docs/circuit-mapping.md.
//    ⇒ zeros[] và root của baseline KHÁC GIÁ TRỊ bên Halo2, nhưng CÙNG cấu trúc.
// =============================================================================

const { buildPoseidon } = require("circomlibjs");

const MERKLE_DEPTH = 9;

// =========================
// POSEIDON — nạp một lần
// =========================

let poseidonInstance: any = null;

async function getPoseidon() {

    if (poseidonInstance === null) {
        poseidonInstance =
            await buildPoseidon();
    }

    return poseidonInstance;
}

// Trả về BigInt để mọi chỗ dùng chung một kiểu.
async function poseidonHash(
    inputs: (string | bigint)[]
): Promise<bigint> {

    const poseidon =
        await getPoseidon();

    const out =
        poseidon(
            inputs.map(
                (x) => BigInt(x)
            )
        );

    return BigInt(
        poseidon.F.toString(out)
    );
}

// =========================
// CÂY
// =========================

class MerkleTree {

    depth: number;
    nodes: bigint[][];
    zeros: bigint[];

    constructor(
        depth: number
    ) {
        this.depth = depth;

        this.nodes = [];

        for (let i = 0; i <= depth; i++) {
            this.nodes.push([]);
        }

        // Dung sau bang buildZeros() vi Poseidon la async.
        this.zeros = [];
    }

    // =========================
    // BANG GOC CAY CON RONG — A18
    // =========================
    //
    //   zeros[0]   = 0
    //   zeros[l+1] = H(zeros[l], zeros[l])
    //
    // Sao y empty_subtree_roots() cua merkle_tree.rs:211.
    // Tornado lay zeros[0] = keccak("tornado") % p de o trong khong the
    // trung mot la hop le; la cua ta la output Poseidon nen xac suat trung
    // 0 khong dang ke, dung 0 cho gon — dung nhu ban Rust.
    async buildZeros() {

        const z: bigint[] = [
            BigInt(0)
        ];

        for (
            let level = 0;
            level < this.depth;
            level++
        ) {
            const truoc =
                z[level];

            if (truoc === undefined) {
                throw new Error(
                    `Bang zeros hong o tang ${level}`
                );
            }

            z.push(
                await poseidonHash([
                    truoc,
                    truoc
                ])
            );
        }

        this.zeros = z;
    }

    zeroAt(
        level: number
    ): bigint {

        const z =
            this.zeros[level];

        if (z === undefined) {
            throw new Error(
                `Chua dung bang zeros — goi buildZeros() truoc.`
                + ` Thieu tang ${level}.`
            );
        }

        return z;
    }

    // Nạp toàn bộ lá một lượt rồi dựng cây MỘT lần.
    // Bản Rust gọi build_tree() sau MỖI insert; kết quả cuối giống nhau,
    // nhưng làm một lần thì đỡ n lần dựng lại.
    async insertAll(
        leaves: bigint[]
    ) {
        await this.buildZeros();

        this.nodes[0] =
            leaves.slice();

        await this.buildTree();
    }

    async buildTree() {

        for (
            let level = 0;
            level < this.depth;
            level++
        ) {
            const current =
                this.nodes[level];

            // tsconfig bat noUncheckedIndexedAccess (soi guong hai repo),
            // nen truy cap mang tra ve T | undefined. Kiem that, khong ep kieu:
            // undefined o day nghia la cay dung sai, phai bao ngay.
            if (current === undefined) {
                throw new Error(
                    `Cay hong: thieu tang ${level}`
                );
            }

            const next: bigint[] = [];

            for (
                let i = 0;
                i < current.length;
                i += 2
            ) {
                const left =
                    current[i];

                if (left === undefined) {
                    throw new Error(
                        `Cay hong: tang ${level} thieu nut ${i}`
                    );
                }

                // A18 — ô trống lấy zeros[level], KHÔNG nhân đôi nút trái.
                // Quy uoc nhan doi lam root khong xac dinh duy nhat tap la
                // (CVE-2012-2459). Phai khop merkle_tree.rs:297.
                const right =
                    i + 1 < current.length
                        ? current[i + 1]
                        : this.zeroAt(level);

                if (right === undefined) {
                    throw new Error(
                        `Cay hong: tang ${level} thieu nut ${i + 1}`
                    );
                }

                next.push(
                    await poseidonHash([
                        left,
                        right
                    ])
                );
            }

            this.nodes[level + 1] =
                next;
        }
    }

    root(): bigint {

        const tangCuoi =
            this.nodes[this.depth];

        if (
            tangCuoi === undefined
            || tangCuoi[0] === undefined
        ) {
            throw new Error(
                `Chua dung cay hoac cay rong — goi insertAll() truoc khi lay root.`
            );
        }

        return tangCuoi[0];
    }

    // merkle_tree.rs:313
    getPath(
        index: number
    ): {
        siblings: bigint[];
        directions: number[];
    } {
        const siblings: bigint[] = [];
        const directions: number[] = [];

        let idx = index;

        for (
            let level = 0;
            level < this.depth;
            level++
        ) {
            const levelNodes =
                this.nodes[level];

            if (levelNodes === undefined) {
                throw new Error(
                    `Cay hong: thieu tang ${level}`
                );
            }

            const isRight =
                idx % 2 === 1;

            const siblingIndex =
                isRight
                    ? idx - 1
                    : idx + 1;

            // A18 — sibling ngoài biên là Ô TRỐNG, lấy zeros[level].
            // Trước 28/08 lấy chính nó (nhân đôi). Phải khop merkle_tree.rs:480.
            const sibling =
                siblingIndex < levelNodes.length
                    ? levelNodes[siblingIndex]
                    : this.zeroAt(level);

            if (sibling === undefined) {
                throw new Error(
                    `Cay hong: tang ${level}, khong lay duoc sibling cho index ${idx}`
                );
            }

            siblings.push(sibling);

            directions.push(
                isRight ? 1 : 0
            );

            idx = Math.floor(idx / 2);
        }

        return {
            siblings,
            directions
        };
    }
}

// =========================
// COMMITMENT / NULLIFIER
// =========================

// commitment.rs:20 — cm = Poseidon(student_id, amount, rho)
async function createCommitment(
    studentId: string | bigint,
    amount: string | bigint,
    rho: string | bigint
): Promise<bigint> {

    return poseidonHash([
        studentId,
        amount,
        rho
    ]);
}

// commitment.rs:40 — nf = Poseidon(rho)
async function createNullifier(
    rho: string | bigint
): Promise<bigint> {

    return poseidonHash([
        rho
    ]);
}

module.exports = {
    MERKLE_DEPTH,
    MerkleTree,
    poseidonHash,
    createCommitment,
    createNullifier
};
