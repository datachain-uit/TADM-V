use prover::{experiment, export_verifier, flow_inputs, generate_proof};

fn print_usage() {
    eprintln!("Usage:");

    eprintln!("  prover commitment");

    eprintln!("  prover rho");

    eprintln!("  prover nullifier");

    eprintln!("  prover root");

    eprintln!("  prover prove");

    eprintln!("  prover export-verifier");

    eprintln!("  prover export-verifier-from-dataset <dataset.json>");

    eprintln!("  prover bench-from-dataset <dataset.json>");

    eprintln!("  prover check-k <dataset.json>");
}

fn dataset_path(args: &[String]) -> &str {
    args.get(2).map(String::as_str).unwrap_or_else(|| {
        print_usage();

        panic!("Missing dataset path");
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(String::as_str) {
        Some("commitment") => flow_inputs::run_commitment(),
        Some("nullifier") => flow_inputs::run_nullifier(),
        Some("root") => flow_inputs::run_root(),
        Some("rho") => flow_inputs::run_rho(),
        Some("prove") => generate_proof::run_prove(),
        Some("export-verifier") => export_verifier::run_export_verifier(),
        Some("export-verifier-from-dataset") => experiment::run_export_verifier_from_dataset(dataset_path(&args)),
        Some("check-k") => experiment::run_check_k(dataset_path(&args)),
        Some("bench-from-dataset") => experiment::run_bench_from_dataset(dataset_path(&args)),

        None => {
            eprintln!("No mode provided. Defaulting to prove mode.");

            generate_proof::run_prove();
        }

        Some(other) => {
            eprintln!("Unknown prover mode: {}", other);

            print_usage();

            std::process::exit(1);
        }
    }
}
