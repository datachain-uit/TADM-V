mod generate_proof;
mod inputs_builder;
mod transfer_address;
mod utils;



fn main() {
    let mode =
        std::env::args()
            .nth(1)
            .unwrap_or_else(
                || "prove".to_string()
            );



    match mode.as_str() {

        // Chỉ tính commitment từ note.
        // Không xây Merkle Tree.
        // Không tạo proof.
        "commitment" => {
            generate_proof::
                compute_commitment_only();
        }


        // ONE-TIME SETUP:
        //
        // Sinh và lưu params vào shared/.
        // Chạy lại khi đổi K hoặc MERKLE_DEPTH.
        "setup" => {
            generate_proof::run_setup();
        }


        // Xác thực proof off-chain, tách hẳn
        // khỏi bước tạo proof.
        // Trả {verified, setup_ms, verify_ms}.
        "verify" => {
            generate_proof::verify_proof_only();
        }


        // A26 — lấy mẫu `rho` trong trường, trả word 32 byte.
        // Node chỉ đổi định dạng sang thập phân.
        "rho" => {
            utils::generate_rho_only();
        }


        // Chỉ tính nullifier từ rho.
        // Không xây Merkle Tree.
        // Không tạo proof.
        "nullifier" => {
            generate_proof::
                compute_nullifier_only();
        }


        // LAP20 — kiểm K hiện tại (HALO2_K) có đủ hàng cho
        // MERKLE_DEPTH hiện tại không. Không xoá file params.
        "check-k" => {
            generate_proof::run_check_k();
        }


        // Chỉ tính root.
        // Không create_proof.
        "root" => {
            generate_proof::
                compute_root_only();
        }

        // Tạo proof sau khi root
        // đã nằm trên smart contract.
        "prove" => {
            let _ =
                generate_proof::
                    generate_real_proof();
        }

        /*
         * LAP20 (17/09/2026) — sinh n proof trong MOT tien trinh, keygen mot
         * lan cho ca luot. Dung de do o CUNG DIEU KIEN voi nhanh on-chain
         * (`bench-from-dataset`). Mode `prove` o tren khong bi anh huong.
         */
        "prove-batch" => {
            generate_proof::
                run_prove_batch();
        }

        _ => {
            eprintln!(
                "Unsupported mode: {}",
                mode
            );

            eprintln!(
                "Supported modes: setup, check-k, rho, commitment, nullifier, root, prove, prove-batch, verify"
            );

            std::process::exit(1);
        }
    }
}