use prover::{experiment, flow_inputs, generate_proof};

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "prove".to_string());

    match mode.as_str() {
        "setup" => generate_proof::run_setup(),
        "check-k" => generate_proof::run_check_k(),
        "rho" => flow_inputs::run_rho(),
        "commitment" => flow_inputs::run_commitment(),
        "nullifier" => flow_inputs::run_nullifier(),
        "root" => flow_inputs::run_root(),
        "prove" => generate_proof::run_prove(),
        "prove-batch" => experiment::run_prove_batch(),
        "verify" => generate_proof::run_verify(),

        _ => {
            eprintln!("Unsupported mode: {}", mode);

            eprintln!("Supported modes: setup, check-k, rho, commitment, nullifier, root, prove, prove-batch, verify");

            std::process::exit(1);
        }
    }
}
