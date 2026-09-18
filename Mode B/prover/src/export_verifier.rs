use snark_verifier_sdk::evm::gen_evm_verifier_sol_code;
use halo2_base::halo2_proofs::poly::kzg::commitment::ParamsKZG;
use halo2_base::halo2_proofs::poly::commitment::Params;
use halo2_base::halo2_proofs::halo2curves::bn256::{Bn256, Fr};
use std::{
    fs,
    path::PathBuf,
};
use snark_verifier_sdk::SHPLONK;
use halo2_base::gates::circuit::builder::BaseCircuitBuilder;

pub fn export_verifier(
    params: &ParamsKZG<Bn256>,
    vk: &halo2_base::halo2_proofs::plonk::VerifyingKey<
        halo2_base::halo2_proofs::halo2curves::bn256::G1Affine
    >,
) {
    // let degree_bounds = vec![params.k() as usize];
    // A25 — 4 public input: root, nullifier, amount, recipient.
    let num_instance = vec![1, 1, 1, 1];

    let sol_code = gen_evm_verifier_sol_code::<BaseCircuitBuilder<Fr>, SHPLONK>(
        params,
        vk,
        num_instance,
    );

    // Dùng CARGO_MANIFEST_DIR để đường dẫn không phụ thuộc
    // thư mục đang đứng khi chạy prover.
    let output_path =
        PathBuf::from(
            env!("CARGO_MANIFEST_DIR")
        )
        .join(
            "../contracts/contracts/Halo2Verifier.sol"
        );

    fs::write(
        &output_path,
        sol_code,
    )
    .expect(
        "Không ghi được Halo2Verifier.sol"
    );

    eprintln!(
        "Verifier.sol generated at {}",
        output_path.display()
    );
}