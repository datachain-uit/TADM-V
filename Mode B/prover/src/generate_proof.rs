use std::fs;

use ff_ce::hex;
use halo2_base::halo2_proofs::{
    halo2curves::bn256::{Bn256, Fr, G1Affine},
    plonk::{keygen_pk, keygen_vk},
    poly::kzg::commitment::ParamsKZG,
};
use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use serde_json::json;
use snark_verifier::loader::evm::encode_calldata;
use snark_verifier_sdk::evm::gen_evm_proof_shplonk;

pub struct VerifierSetupOutput {
    pub params: ParamsKZG<Bn256>,

    pub vk: halo2_base::halo2_proofs::plonk::VerifyingKey<G1Affine>,
}

pub fn setup_fixed_params() -> ParamsKZG<Bn256> {
    let rng = ChaCha20Rng::from_seed([42u8; 32]);

    ParamsKZG::<Bn256>::setup(circuits::circuit::k() as u32, rng)
}

pub fn prepare_verifier_setup() -> VerifierSetupOutput {
    let circuit_data = crate::flow_inputs::build_keygen_circuit();

    let builder = circuit_data.create_builder();

    let params = setup_fixed_params();

    let vk = keygen_vk(&params, &builder).expect("keygen_vk failed");

    eprintln!("\n========================");

    eprintln!("VERIFIER SETUP PREPARED");

    eprintln!("NO PROOF WAS CREATED");

    eprintln!("========================");

    VerifierSetupOutput { params, vk }
}

pub fn run_prove() {
    let circuit_data = crate::flow_inputs::build_inputs();
    let builder = circuit_data.create_builder();

    let instances: Vec<Vec<Fr>> = builder
        .assigned_instances
        .iter()
        .map(|column| column.iter().map(|assigned| *assigned.value()).collect())
        .collect();

    let params = setup_fixed_params();
    let vk = keygen_vk(&params, &builder).expect("keygen_vk failed");
    let pk = keygen_pk(&params, vk.clone(), &builder).expect("keygen_pk failed");

    eprintln!("Generating an EVM-compatible proof (SHPLONK)...");
    let proof = gen_evm_proof_shplonk(&params, &pk, builder, instances.clone());

    let clean_calldata = encode_calldata(&instances, &proof);
    let calldata_hex = hex::encode(&clean_calldata);
    let proof_hex = hex::encode(&proof);

    if clean_calldata.len() < 128 {
        panic!("Calldata does not contain root, nullifier, amount and recipient");
    }

    let root_hex = format!("0x{}", hex::encode(&clean_calldata[0..32]));

    let nullifier_hex = format!("0x{}", hex::encode(&clean_calldata[32..64]));

    let amount_hex = format!("0x{}", hex::encode(&clean_calldata[64..96]));
    let recipient_hex = format!("0x{}", hex::encode(&clean_calldata[96..128]));

    let output = json!({
        "proof": format!("0x{}", proof_hex),
        "calldata": format!("0x{}", calldata_hex),
        "root": root_hex,
        "nullifier": nullifier_hex,
        "amount": amount_hex,
        "recipient": recipient_hex
    });

    fs::write("proof.json", output.to_string()).unwrap();

    println!("{}", output.to_string());

    eprintln!("proof.json written with the normalized calldata");

    eprintln!("\n=============================");

    eprintln!("PROOF GENERATION COMPLETED");

    eprintln!("=============================");

    eprintln!("proof = 0x{}", proof_hex);

    eprintln!("root = {:?}", circuit_data.expected_root);

    eprintln!("nullifier = {:?}", circuit_data.expected_nullifier);

    eprintln!("Halo2Verifier.sol was NOT regenerated");
}
