use snark_verifier_sdk::{
    evm::gen_evm_verifier,
};

use crate::generate_proof::generate_real_proof;

pub fn export_solidity_verifier() {

    let proof_data =
        generate_real_proof();

    let deployment_code =
        gen_evm_verifier(
            &proof_data.params,
            &proof_data.vk,
            vec![3],
            None,
        );

    std::fs::write(
        "../contracts/contracts/Halo2Verifier.sol",
        deployment_code
    ).unwrap();

    println!("Verifier exported!");
}