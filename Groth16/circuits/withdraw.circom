pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

// =============================================================================
// MẠCH BASELINE — Groth16 / circom
//
// Quan hệ chứng minh SAO CHÉP TỪ mạch Halo2 của bài, không thiết kế lại:
//
//   zk-halo2-onchain/circuits/src/note.rs:14         Note = (student_id, amount, rho)
//   zk-halo2-onchain/circuits/src/commitment.rs:20   cm = Poseidon(student_id, amount, rho)
//   zk-halo2-onchain/circuits/src/commitment.rs:40   nf = Poseidon(rho)
//   zk-halo2-onchain/circuits/src/merkle_tree.rs:231 parent = Poseidon(left, right)
//   zk-halo2-onchain/circuits/src/merkle_tree.rs:511 direction boolean + mux left/right
//   zk-halo2-onchain/circuits/src/circuit.rs         public = [root, nullifier, amount, recipient]
//   zk-halo2-onchain/prover/src/flow_inputs.rs:14    MERKLE_DEPTH = 9
//
// ⚠️ CHỖ KHÔNG THỂ GIỐNG — phải nêu trong bài, đừng giấu:
//   Halo2 dùng halo2_base PoseidonHasher<Fr,3,2> — SPONGE rate 2, hấp thụ nhiều lần.
//   circomlib dùng Poseidon(n) bề rộng cố định t = n+1, một lần hoán vị.
//   ⇒ Cùng họ hàm băm, cùng đường cong BN254, nhưng CẤU TRÚC HẤP THỤ khác nhau
//     nên GIÁ TRỊ commitment KHÔNG trùng bit.
//   ⇒ Bài được phép nói "cùng cấu trúc quan hệ, cùng độ sâu, cùng số public input".
//     Bài KHÔNG được nói "cùng commitment" hay "cùng root".
//   Chi tiết: docs/circuit-mapping.md
// =============================================================================


// =========================
// MERKLE PATH
// =========================
//
// Sao chép MerkleTreeChip::compute_root (merkle_tree.rs:474).
// direction = 0 -> nút hiện tại nằm BÊN TRÁI
// direction = 1 -> nút hiện tại nằm BÊN PHẢI
template MerklePath(depth) {

    signal input leaf;
    signal input siblings[depth];
    signal input directions[depth];

    signal output root;

    component hasher[depth];

    signal cur[depth + 1];
    signal left[depth];
    signal right[depth];

    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {

        // Ràng buộc 1 — direction phải là 0 hoặc 1.
        // Bản Halo2: gate.assert_is_const(direction * (direction - 1), 0)
        directions[i] * (directions[i] - 1) === 0;

        // Ràng buộc 2 — chọn trái/phải bằng mux, KHÔNG bằng rẽ nhánh.
        // left  = cur      + d * (sibling - cur)
        // right = sibling  + d * (cur - sibling)
        // Giống hệt biểu thức ở merkle_tree.rs:546-588 và config.rs:133-153.
        left[i]  <== cur[i]      + directions[i] * (siblings[i] - cur[i]);
        right[i] <== siblings[i] + directions[i] * (cur[i] - siblings[i]);

        hasher[i] = Poseidon(2);
        hasher[i].inputs[0] <== left[i];
        hasher[i].inputs[1] <== right[i];

        cur[i + 1] <== hasher[i].out;
    }

    root <== cur[depth];
}


// =========================
// WITHDRAW
// =========================
template Withdraw(depth) {

    // --- nhân chứng riêng tư ---
    // Bốn thứ này KHÔNG BAO GIỜ được chạm bề mặt công khai.
    // Bất biến C6 của bài; ở đây cũng phải giữ.
    signal input student_id;
    signal input rho;
    signal input siblings[depth];
    signal input directions[depth];

    // --- public input, ĐÚNG THỨ TỰ [root, nullifier, amount, recipient] ---
    signal input root;
    signal input nullifier;
    signal input amount;

    // -------------------------------------------------------------
    // A25 (2026-09-12) — ví nhận là public input thứ TƯ, theo hai nhánh chính.
    //
    // Vì sao cần: nếu proof không nói gì về ví nhận thì nó là tờ ngân phiếu vô
    // danh — ai chép được proof trong mempool cũng gửi lại được với ví của mình.
    // Xem DECISIONS.md A25.
    //
    // ⚠️ PHẢI có ràng buộc giả, KHÔNG được để signal trôi nổi. Trong Groth16,
    // public input nào không xuất hiện trong ràng buộc nào thì điểm IC của nó
    // bằng 0, nên verifier cộng vào 0 — đổi giá trị đó mà proof VẪN hợp lệ, tức
    // ràng buộc là GIẢ. Nhân nó với chính nó để ép vào R1CS.
    //
    // Đây đúng là cách Tornado Cash ràng `recipient`/`relayer`/`fee`
    // ("not taking part in any computations"), không phải mẹo tự nghĩ.
    //
    // Khác Halo2 ở CHỖ NỐI, không ở ý nghĩa: Halo2 copy-constrain ô witness vào
    // cột instance; circom ép bằng một ràng buộc bậc hai. Cả hai đều làm proof
    // chỉ hợp lệ với đúng một ví nhận. `recipient` KHÔNG vào commitment ở cả hai.
    // -------------------------------------------------------------
    signal input recipient;
    signal recipientSquare;
    recipientSquare <== recipient * recipient;

    // -------------------------------------------------------------
    // cm = Poseidon(student_id, amount, rho)
    //
    // amount VỪA là nhân chứng đi vào commitment VỪA là public input.
    // Đây là C3: đổi amount thì cm đổi, Merkle membership hỏng.
    // -------------------------------------------------------------
    component cm = Poseidon(3);
    cm.inputs[0] <== student_id;
    cm.inputs[1] <== amount;
    cm.inputs[2] <== rho;

    // -------------------------------------------------------------
    // nf = Poseidon(rho), và phải khớp public input
    // -------------------------------------------------------------
    component nf = Poseidon(1);
    nf.inputs[0] <== rho;
    nf.out === nullifier;

    // -------------------------------------------------------------
    // Merkle membership: đường dẫn từ cm phải dẫn tới đúng root
    // -------------------------------------------------------------
    component path = MerklePath(depth);
    path.leaf <== cm.out;

    for (var i = 0; i < depth; i++) {
        path.siblings[i]   <== siblings[i];
        path.directions[i] <== directions[i];
    }

    path.root === root;
}


// MERKLE_DEPTH = 9 — khớp prover/src/flow_inputs.rs:14. ĐỪNG đổi số này mà không
// đổi cả hai repo kia; nó là một trong các bất biến CLAUDE.md liệt kê.
//
// 🔴 ĐỔI 7 -> 9 ngày 2026-09-07, theo hai nhánh chính. Vì sao 9: UIT cấp 353 suất
// HBKKHT HK1 2025-26 (QĐ 653/QĐ-ĐHCNTT ngày 09/6/2026); 353 > 256 nên d = 8 khong
// chua noi mot dot that. d = 9 = 512 la, va n = 500 dung 97,7 % suc chua.
//
// ⚠️ Doi d o Groth16 KHONG phai doi mot hang so: no doi MACH, keo theo bien dich
// lai .r1cs/.wasm -> chay lai TOAN BO ceremony -> .zkey moi -> verifier moi ->
// deploy lai -> moi proof cu het hieu luc. ADV khong can gi (dung lai vk tu mach
// moi lan chay); ONC chi can export-verifier + deploy. Chinh chenh lech nay LA
// MOT KET QUA dang viet trong bai: chi phi bao tri cua Groth16 khi tham so he doi.
component main {public [root, nullifier, amount, recipient]} = Withdraw(9);
