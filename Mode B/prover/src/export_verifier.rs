use halo2_base::gates::circuit::builder::BaseCircuitBuilder;
use halo2_base::halo2_proofs::halo2curves::bn256::{Bn256, Fr};
use halo2_base::halo2_proofs::poly::kzg::commitment::ParamsKZG;
use snark_verifier_sdk::evm::gen_evm_verifier_sol_code;
use snark_verifier_sdk::SHPLONK;
use std::{fs, path::PathBuf};

fn remove_comment_lines(sol_code: &str) -> String {
    sol_code
        .split_inclusive('\n')
        .filter(|line| {
            let trimmed = line.trim_start();

            !trimmed.starts_with("//") || trimmed.starts_with("// SPDX-License-Identifier")
        })
        .collect()
}

pub fn export_verifier(
    params: &ParamsKZG<Bn256>,
    vk: &halo2_base::halo2_proofs::plonk::VerifyingKey<halo2_base::halo2_proofs::halo2curves::bn256::G1Affine>,
) {
    let num_instance = vec![1, 1, 1, 1];

    let sol_code = gen_evm_verifier_sol_code::<BaseCircuitBuilder<Fr>, SHPLONK>(params, vk, num_instance);

    let output_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/contracts/Halo2Verifier.sol");

    fs::write(&output_path, remove_comment_lines(&sol_code)).expect("Cannot write Halo2Verifier.sol");

    eprintln!("Verifier.sol generated at {}", output_path.display());
}

pub fn run_export_verifier() {
    let setup = crate::generate_proof::prepare_verifier_setup();

    export_verifier(&setup.params, &setup.vk);

    eprintln!("Halo2Verifier.sol exported successfully");

    eprintln!("No proof was created during verifier export");

    println!("{{\"success\":true,\"file\":\"contracts/contracts/Halo2Verifier.sol\"}}");
}
