// // // use prover::generate_proof::generate_proof;
// // use prover::export_verifier::export_verifier;
// // use ff_ce::hex;
// // fn main() {
// //     let result = prover::generate_proof::generate_proof();
// //     eprintln!("proof = 0x{}", hex::encode(result.proof));
// //     eprintln!("root = {:?}", result.root);
// //     eprintln!("nullifier = {:?}", result.nullifier);
// //     // eprintln!("root = {:?}", result.root);
// //     // eprintln!("nullifier = {:?}", result.nullifier);
// //     export_verifier(&result.params, &result.vk);

// // }




// mod inputs_builder;
// mod generate_proof;
// mod export_verifier;
// mod experiment;

// fn main() {
//     let args: Vec<String> =
//         std::env::args().collect();

//     // =============================================
//     // MODE 1:
//     // Export Halo2Verifier.sol
//     // =============================================

//     if args.len() > 2 && args[1] == "export-verifier-from-dataset" {
//         experiment::export_verifier_from_dataset_file(
//             &args[2]
//         );

//         return;
//     }

//     // =============================================
//     // MODE 2:
//     // Generate proofs from dataset
//     // =============================================

//     if args.len() > 2 && args[1] == "bench-from-dataset" {
//         experiment::run_benchmark_from_dataset_file(
//             &args[2]
//         );

//         return;
//     }

//     // =============================================
//     // DEFAULT MODE:
//     // Flow cũ của bạn
//     // =============================================

//     let output =
//         generate_proof::generate_proof();

//     export_verifier::export_verifier(
//         &output.params,
//         &output.vk
//     );
// }














mod inputs_builder;
mod flow_inputs;
mod generate_proof;
mod export_verifier;
mod experiment;
use prover::export_verifier::export_verifier;

use ff_ce::hex;

// =============================================
// MODE: PROVE
//
// Tạo proof cho sinh viên.
// KHÔNG export lại Halo2Verifier.sol.
// =============================================

fn run_prove() {
    let output =
        generate_proof::
            generate_proof();

    eprintln!(
        "\n============================="
    );

    eprintln!(
        "PROOF GENERATION COMPLETED"
    );

    eprintln!(
        "============================="
    );

    eprintln!(
        "proof = 0x{}",
        hex::encode(
            &output.proof
        )
    );

    eprintln!(
        "root = {:?}",
        output.root
    );

    eprintln!(
        "nullifier = {:?}",
        output.nullifier
    );

    eprintln!(
        "Halo2Verifier.sol was NOT regenerated"
    );
}

// =============================================
// MODE: EXPORT VERIFIER
//
// Chỉ dùng trong bước setup ban đầu,
// hoặc sau khi circuit thay đổi.
//
// Lệnh này tạo Halo2Verifier.sol.
// =============================================

// fn run_export_verifier() {
//     let output =
//         generate_proof::
//             generate_proof();

//     export_verifier::
//         export_verifier(
//             &output.params,
//             &output.vk,
//         );

//     eprintln!(
//         "\n============================="
//     );

//     eprintln!(
//         "HALO2 VERIFIER EXPORTED"
//     );

//     eprintln!(
//         "============================="
//     );

//     eprintln!(
//         "Halo2Verifier.sol exported successfully"
//     );
// }



fn run_export_verifier() {
    let setup =
        prover::
            generate_proof::
            prepare_verifier_setup();

    export_verifier(
        &setup.params,
        &setup.vk
    );

    eprintln!(
        "Halo2Verifier.sol exported successfully"
    );

    eprintln!(
        "No proof was created during verifier export"
    );

    println!(
        "{{\"success\":true,\"file\":\"contracts/contracts/Halo2Verifier.sol\"}}"
    );
}





// =============================================
// HELP
// =============================================

fn print_usage() {
    eprintln!(
        "Usage:"
    );

    eprintln!(
        "  prover commitment"
    );

    eprintln!(
        "  prover rho"
    );

    eprintln!(
        "  prover nullifier"
    );

    eprintln!(
        "  prover root"
    );

    eprintln!(
        "  prover prove"
    );

    eprintln!(
        "  prover export-verifier"
    );

    eprintln!(
        "  prover export-verifier-from-dataset <dataset.json>"
    );

    eprintln!(
        "  prover bench-from-dataset <dataset.json>"
    );

    eprintln!(
        "  prover check-k <dataset.json>"
    );
}

// =============================================
// MAIN
// =============================================

fn main() {
    let args:
        Vec<String> =
        std::env::args()
            .collect();

    let mode =
        args
            .get(1)
            .map(
                String::as_str
            );

    match mode {
        Some("commitment") => {
            flow_inputs::compute_commitment_only();
        }

        Some("nullifier") => {
            flow_inputs::compute_nullifier_only();
        }

        // =====================================
        // SCHOOL PHASE:
        //
        // Tính root, nullifier và public amount.
        // Không tạo proof.
        // =====================================

        Some("root") => {
            flow_inputs::compute_root_only();
        }

        // =====================================
        // STUDENT PHASE:
        //
        // Root đã được cập nhật lên blockchain.
        // Sau đó mới tạo proof.
        //
        // Không export verifier lại.
        // =====================================

        // =====================================
        // A26: lay mau `rho` trong truong, o Rust.
        // Node chi doi dinh dang sang thap phan.
        // =====================================

        Some("rho") => {
            flow_inputs::generate_rho_only();
        }

        Some("prove") => {
            run_prove();
        }

        // =====================================
        // ONE-TIME SETUP:
        //
        // Tạo Halo2Verifier.sol.
        // Chỉ chạy khi:
        // - setup project lần đầu;
        // - circuit thay đổi;
        // - số public inputs thay đổi;
        // - K thay đổi.
        // =====================================

        Some("export-verifier") => {
            run_export_verifier();
        }

        // =====================================
        // EXPERIMENT MODE 1:
        //
        // Export verifier từ dataset.
        // Giữ nguyên chức năng benchmark cũ.
        // =====================================

        Some(
            "export-verifier-from-dataset"
        ) => {
            let dataset_path =
                args
                    .get(2)
                    .unwrap_or_else(
                        || {
                            print_usage();

                            panic!(
                                "Missing dataset path"
                            );
                        }
                    );

            experiment::
                export_verifier_from_dataset_file(
                    dataset_path
                );
        }

        // =====================================
        // LAP20 — kiểm K hiện tại (HALO2_K) có đủ
        // hàng cho độ sâu của dataset không.
        // Không ghi file, không sinh proof.
        // =====================================

        Some(
            "check-k"
        ) => {
            let dataset_path =
                args
                    .get(2)
                    .unwrap_or_else(
                        || {
                            print_usage();

                            panic!(
                                "Missing dataset path"
                            );
                        }
                    );

            experiment::
                check_k_from_dataset_file(
                    dataset_path
                );
        }

        // =====================================
        // EXPERIMENT MODE 2:
        //
        // Sinh proofs từ dataset.
        // =====================================

        Some(
            "bench-from-dataset"
        ) => {
            let dataset_path =
                args
                    .get(2)
                    .unwrap_or_else(
                        || {
                            print_usage();

                            panic!(
                                "Missing dataset path"
                            );
                        }
                    );

            experiment::
                run_benchmark_from_dataset_file(
                    dataset_path
                );
        }

        // =====================================
        // BACKWARD COMPATIBILITY:
        //
        // Nếu backend cũ chạy prover mà
        // không truyền mode, mặc định tạo proof.
        //
        // Không export verifier.
        // =====================================

        None => {
            eprintln!(
                "No mode provided. Defaulting to prove mode."
            );

            run_prove();
        }

        // =====================================
        // INVALID MODE
        // =====================================

        Some(other) => {
            eprintln!(
                "Unknown prover mode: {}",
                other
            );

            print_usage();

            std::process::exit(
                1
            );
        }
    }
}
