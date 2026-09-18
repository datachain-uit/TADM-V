// // use halo2_base::{
// //     halo2_proofs::{
// //         dev::MockProver,
// //         halo2curves::bn256::Fr,
// //     },
// // };

// // use circuits::circuit::{ScholarshipCircuit};
// // use crate::inputs_builder::build_inputs;

// // pub fn generate_proof() {
// //     // =========================
// //     // 1. BUILD CIRCUIT INPUTS
// //     // =========================
// //     let circuit: ScholarshipCircuit = build_inputs();

// //     // =========================
// //     // 2. BUILD CIRCUIT BUILDER
// //     // =========================
// //     let mut builder = circuit.create_builder();

// //     // // IMPORTANT: finalize circuit params
// //     builder.calculate_params(None);

// //     // =========================
// //     // 3. PUBLIC INPUTS
// //     // (must match builder.assigned_instances order)
// //     // =========================
// //     let public_inputs = vec![
// //         vec![
// //             circuit.root,
// //             circuit.nullifier,
// //         ]
// //     ];

// //     // =========================
// //     // 4. MOCK PROVER (DEV ONLY)
// //     // =========================
// //     let prover = MockProver::run(
// //         12, // k = circuit size
// //         &builder,
// //         public_inputs,
// //     ).unwrap();

// //     prover.assert_satisfied();

// //     eprintln!("✅ Proof generation (mock) SUCCESS");
// // }



// // #[test]

// // fn test_generate_proof() {
// //     generate_proof();
// // }







// // use halo2_base::halo2_proofs::halo2curves::bn256::{Bn256, Fr};
// // use snark_verifier_sdk::halo2::gen_snark;
// // use snark_verifier_sdk::{SHPLONK, gen_pk};
// // use snark_verifier_sdk::Snark;
// // use circuits::circuit::ScholarshipCircuit;
// // use crate::inputs_builder::build_inputs;

// // pub fn generate_real_proof() {
// //     // =========================
// //     // 1. INPUT
// //     // =========================
// //     let circuit: ScholarshipCircuit = build_inputs();
// //     // let circuit = ScholarshipCircuit::new(
// //     //     note,
// //     //     witness,
// //     //     root,
// //     //     nullifier,
// //     // );

// //     // let app_circuit = circuit.to_circuit_ext();

// //     // =========================
// //     // 2. BUILD CIRCUIT BUILDER
// //     // =========================
// //     // let builder = circuit.create_builder();

// //     // IMPORTANT: builder must be finalized
// //     // (Bạn đã làm đúng ở circuit.calculate_params)

// //     // =========================
// //     // 3. BUILD SNARK CIRCUIT WRAPPER
// //     // =========================
// //     // let app_circuit = builder;

// //     // =========================
// //     // 4. KEYGEN
// //     // =========================
// //     // let (pk, vk) = app_circuit.keygen::<SHPLONK>().unwrap();
// //     // let snark = app_circuit.prove(&pk).unwrap();
// //     // let ok = app_circuit.verify(&vk, &snark).unwrap();



// //     use snark_verifier_sdk::SHPLONK;

// //     // 1. INPUT
// //     let circuit = build_inputs();

// //     // 2. BUILD CIRCUIT EXT (ĐÚNG CÁCH)
// //     let app_circuit = circuit.to_circuit_ext();

// //     // 3. KEYGEN (ĐÚNG API VERSION 0.2.3)
// //     let pk = gen_pk::<SHPLONK, _>(&circuit_ext);

// //     // 4. PROVE
// //     let snark = gen_snark::<SHPLONK, _>(&pk, &circuit_ext);

// //     // 5. VERIFY (off-chain test)
// //     let ok = snark_verifier_sdk::halo2::verify_snark::<SHPLONK>(
// //         &pk.get_vk(),
// //         &snark,
// //     );

// //     eprintln!("VERIFY = {:?}", ok);



// //     // =========================
// //     // 5. PROVE (REAL)
// //     // =========================
// //     // let snark: Snark = app_circuit
// //     //     .prove(&pk)
// //     //     .expect("prove failed");

// //     // =========================
// //     // 6. PRINT PROOF
// //     // =========================
// //     // eprintln!("==============================");
// //     // eprintln!("REAL ZK PROOF GENERATED");
// //     // eprintln!("==============================");

// //     // eprintln!("PROOF BYTES:");
// //     // eprintln!("{:?}", snark.proof);

// //     // eprintln!("PUBLIC INPUTS:");
// //     // eprintln!("{:?}", snark.instances);

// //     // =========================
// //     // 7. VERIFY
// //     // =========================
// //     // let ok = app_circuit
// //     //     .verify(&vk, &snark)
// //     //     .expect("verify failed");

// //     // eprintln!("VERIFY = {:?}", ok);
// // }










// use halo2_base::halo2_proofs::halo2curves::bn256::{Bn256, Fr};
// use snark_verifier_sdk::{
//     SHPLONK,
//     gen_pk,
//     halo2::gen_snark,
//     Snark,
// };
// use snark_verifier::system::halo2::transcript::evm::EvmTranscript;
// use snark_verifier::loader::halo2::halo2_ecc::halo2_base::Context;

// use halo2_base::halo2_proofs::poly::kzg::commitment::ParamsKZG;
// use halo2_base::halo2curves::bn256::Bn256;
// use circuits::circuit::ScholarshipCircuit;
// use crate::inputs_builder::build_inputs;

// // pub fn generate_real_proof() {
// //     // 1. BUILD CIRCUIT
// //     let circuit: ScholarshipCircuit = build_inputs();
// //     let circuit_ext = circuit.to_circuit_ext();

// //     // 2. GENERATE PARAMS (NEW - BẮT BUỘC)
// //     let params = gen_params::<Bn256>(12);

// //     // 3. KEYGEN
// //     let pk = gen_pk(&params, &circuit_ext);

// //     // 4. PROVE
// //     let snark = gen_snark(&params, &pk, circuit_ext, None);

// //     // 5. VERIFY (local test)
// //     let ok = snark.verify(&pk.get_vk());

// //     eprintln!("VERIFY = {:?}", ok);
// // }

// pub fn generate_real_proof() {
//     let circuit = build_inputs();

//     // 1. build native circuit (IMPORTANT: NOT CircuitExt)
//     let circuit_impl = circuit; // ScholarshipCircuit implements constraints

//     // 2. params KZG (THIS IS REQUIRED)
//     let params: ParamsKZG<Bn256> =
//         ParamsKZG::setup(12, rand::thread_rng());

//     // 3. KEYGEN
//     let pk = gen_pk::<SHPLONK, _>(&params, &circuit_impl, None);

//     // 4. PROVE
//     let snark = gen_snark::<SHPLONK, _, _, _>(
//         &params,
//         &circuit_impl,
//         &pk,
//         None,
//     );

//     // 5. VERIFY
//     let vk = pk.get_vk();

//     let ok = snark.verify(&vk);

//     assert!(ok.is_ok());

//     eprintln!("✅ REAL PROOF SUCCESS");
// }


















// use halo2_base::{
//     halo2_proofs::{
//         halo2curves::bn256::{Bn256, Fr},
//         plonk::{create_proof, keygen_pk, keygen_vk},
//         poly::{
//             commitment::ParamsProver,
//             kzg::{
//                 commitment::KZGCommitmentScheme,
//                 multiopen::ProverGWC,
//                 strategy::SingleStrategy,
//             },
//         },
//         transcript::{Blake2bWrite, Blake2bRead, Challenge255},
//     },
//     gates::circuit::builder::BaseCircuitBuilder,
// };

// use rand_core::OsRng;
// use std::fs::File;
// use std::io::Write;

// use crate::circuits::circuit::ScholarshipCircuit;
// use crate::inputs_builder::build_inputs;

// pub fn generate_proof() {
//     // =========================
//     // 1. BUILD CIRCUIT INPUT
//     // =========================
//     let circuit = build_inputs();

//     // =========================
//     // 2. BUILD CIRCUIT BUILDER
//     // =========================
//     let builder = circuit.create_builder();

//     // IMPORTANT: extract params
//     // let params = builder.params();
//     // let params = builder.calculate_params(None);
//     builder.calculate_params(None);
//     let params = builder.params();

//     // =========================
//     // 3. KEYGEN
//     // =========================
//     let vk = keygen_vk(&params, &builder).expect("vk gen failed");
//     let pk = keygen_pk(&params, vk.clone(), &builder).expect("pk gen failed");

//     // =========================
//     // 4. CREATE PROOF
//     // =========================
//     // let mut transcript = Blake2bWrite::<_, _, Challenge255<_>>::init(vec![]);
//     use halo2_base::halo2_proofs::transcript::{Blake2bWrite, Challenge255};

//     let mut transcript = Blake2bWrite::<_, _, Challenge255<_>>::new(vec![]);

//     create_proof::<
//         KZGCommitmentScheme<Bn256>,
//         ProverGWC<_>,
//         Challenge255<_>,
//         _,
//         _,
//         _,
//     >(
//         &params,
//         &pk,
//         &[builder],
//         &[&[]], // public inputs handled by assigned_instances
//         OsRng,
//         &mut transcript,
//     )
//     .expect("proof generation failed");

//     let proof = transcript.finalize();

//     // =========================
//     // 5. EXPORT PROOF
//     // =========================
//     let mut file = File::create("proof.bin").unwrap();
//     file.write_all(&proof).unwrap();

//     eprintln!("✅ Proof generated!");

//     // =========================
//     // 6. OPTIONAL: SAVE VK
//     // =========================
//     let vk_bytes = bincode::serialize(&pk.get_vk()).unwrap();
//     let mut vk_file = File::create("vk.bin").unwrap();
//     vk_file.write_all(&vk_bytes).unwrap();

//     eprintln!("✅ VK saved");
// }













// use halo2_base::{
//     halo2_proofs::{
//         halo2curves::bn256::{Bn256, Fr},
//         plonk::{create_proof, keygen_pk, keygen_vk},
//         poly::kzg::{
//             commitment::KZGCommitmentScheme,
//             multiopen::ProverGWC,
//         },
//         transcript::{Blake2bWrite, Challenge255},
//     },
// };

// use rand_core::OsRng;
// use std::fs::File;
// use std::io::Write;

// use circuits::circuit::ScholarshipCircuit;
// use crate::inputs_builder::build_inputs;

// pub fn generate_proof() {

//     // =========================
//     // 1. CIRCUIT INPUT
//     // =========================
//     let circuit = build_inputs();

//     // =========================
//     // 2. BUILD CIRCUIT
//     // =========================
//     let mut builder = circuit.create_builder();

//     builder.calculate_params(None);

//     // ✅ FIX: lấy params đúng cách
//     // let params = builder.params.clone();
//     let params = builder.config_params.clone();

//     // =========================
//     // 3. KEYGEN
//     // =========================
//     let vk = keygen_vk(&params, &builder).unwrap();
//     let pk = keygen_pk(&params, vk.clone(), &builder).unwrap();

//     // =========================
//     // 4. PROOF
//     // =========================
//     let mut transcript =
//         // Blake2bWrite::<_, _, Challenge255<_>>::new(vec![]);
//         Blake2bWrite::<_, _, Challenge255<_>>::init(vec![]);

//     create_proof::<
//         KZGCommitmentScheme<Bn256>,
//         ProverGWC<_>,
//         Challenge255<_>,
//         _,
//         _,
//         _,
//     >(
//         &params,
//         &pk,
//         &[builder],
//         &[&[]],
//         OsRng,
//         &mut transcript,
//     )
//     .unwrap();

//     let proof = transcript.finalize();

//     // =========================
//     // 5. SAVE PROOF
//     // =========================
//     let mut f = File::create("proof.bin").unwrap();
//     f.write_all(&proof).unwrap();

//     eprintln!("✅ proof generated");
// }



// use halo2_base::halo2_proofs::{
//     halo2curves::bn256::Bn256,
//     plonk::{create_proof, keygen_pk, keygen_vk},
//     poly::kzg::commitment::ParamsKZG,
//     transcript::{Blake2bWrite, Challenge255},
// };

// use rand_core::OsRng;
// use std::fs::File;
// use std::io::Write;

// use crate::inputs_builder::build_inputs;

// pub fn generate_proof() {
//     // =========================
//     // 1. BUILD CIRCUIT
//     // =========================
//     let circuit = build_inputs();

//     // BaseCircuitBuilder
//     let mut builder = circuit.create_builder();

//     // IMPORTANT: finalize constraints
//     builder.calculate_params(None);

//     // =========================
//     // 2. KZG PARAMS
//     // =========================
//     let params = ParamsKZG::<Bn256>::setup(12, OsRng);

//     // =========================
//     // 3. KEYGEN
//     // =========================
//     let vk = keygen_vk(&params, &builder).expect("vk failed");
//     let pk = keygen_pk(&params, vk.clone(), &builder).expect("pk failed");

//     // =========================
//     // 4. PROOF
//     // =========================
//     let mut transcript =
//         Blake2bWrite::<_, _, Challenge255<_>>::init(vec![]);

//     create_proof::<
//         KZGCommitmentScheme<Bn256>,
//         halo2_base::halo2_proofs::poly::kzg::multiopen::ProverGWC<_>,
//         Challenge255<_>,
//         _,
//         _,
//         _,
//     >(
//         &params,
//         &pk,
//         &[builder],
//         &[&[]], // public inputs (nếu bạn có thì thay ở đây)
//         OsRng,
//         &mut transcript,
//     )
//     .expect("proof failed");

//     let proof = transcript.finalize();

//     // =========================
//     // 5. SAVE PROOF
//     // =========================
//     let mut f = File::create("proof.bin").unwrap();
//     f.write_all(&proof).unwrap();

//     eprintln!("✅ Proof generated successfully");
// }












// use halo2_base::halo2_proofs::{
//     dev::MockProver,
//     halo2curves::bn256::Fr,
// };

// use circuits::circuit::ScholarshipCircuit;

// /// Output chuẩn để sau này upgrade sang EVM
// pub struct ProofOutput {
//     pub root: Fr,
//     pub nullifier: Fr,
// }

// pub fn generate_proof() -> ProofOutput {

//     // =========================
//     // 1. BUILD CIRCUIT INPUTS
//     // =========================
//     let circuit = crate::inputs_builder::build_inputs();

//     // =========================
//     // 2. BUILD CIRCUIT BUILDER
//     // =========================
//     let mut builder = circuit.create_builder();

//     builder.calculate_params(None);

//     // =========================
//     // 3. PUBLIC INPUTS
//     // (PHẢI GIỐNG circuit.rs push order)
//     // =========================
//     let public_inputs = vec![
//         vec![circuit.root],
//         vec![circuit.nullifier],
//     ];

//     // =========================
//     // 4. MOCK PROVER
//     // =========================
//     let prover = MockProver::run(
//         12,
//         &builder,
//         public_inputs,
//     ).unwrap();

//     prover.assert_satisfied();

//     eprintln!("✅ PROOF VALID");

//     // =========================
//     // 5. RETURN OUTPUT
//     // =========================
//     ProofOutput {
//         root: circuit.root,
//         nullifier: circuit.nullifier,
//     }
// }





// use halo2_base::halo2_proofs::{
//     plonk::{create_proof, keygen_pk, keygen_vk},
//     poly::commitment::ParamsProver,
//     transcript::{Blake2bWrite, Challenge255},
//     dev::MockProver,
//     halo2curves::bn256::{Bn256, Fr},
// };
// use rand_core::OsRng;

// use circuits::circuit::ScholarshipCircuit;
// use crate::inputs_builder::build_inputs;

// pub fn generate_real_proof() -> Vec<u8> {

//     // =========================
//     // 1. INPUT CIRCUIT
//     // =========================
//     let circuit = build_inputs();
//     let mut builder = circuit.create_builder();
//     builder.calculate_params(None);

//     // =========================
//     // 2. PARAMS (k = 12)
//     // =========================
//     let params: ParamsProver<Bn256> =
//         ParamsProver::new(12);

//     // =========================
//     // 3. KEYGEN
//     // =========================
//     let vk = keygen_vk(&params, &builder).unwrap();
//     let pk = keygen_pk(&params, vk, &builder).unwrap();

//     // =========================
//     // 4. PUBLIC INPUTS
//     // =========================
//     let public_inputs = vec![
//         vec![circuit.root],
//         vec![circuit.nullifier],
//     ];

//     // =========================
//     // 5. PROOF GENERATION
//     // =========================
//     let mut transcript = Blake2bWrite::<_, _, Challenge255<_>>::init(vec![]);

//     create_proof(
//         &params,
//         &pk,
//         &[builder],
//         &[&public_inputs],
//         OsRng,
//         &mut transcript,
//     ).unwrap();

//     // =========================
//     // 6. RETURN PROOF BYTES
//     // =========================
//     transcript.finalize()
// }














// Day la cai chay duoc

// use ff_ce::hex;
// use serde_json::json;
// use std::fs;
// use std::fs::File;
// use std::io::Write;
// use halo2_base::halo2_proofs::{
//     halo2curves::bn256::Fr,
//     halo2curves::bn256::{Bn256, G1Affine},
//     poly::kzg::commitment::{ParamsKZG, KZGCommitmentScheme},
//     plonk::{create_proof, keygen_pk, keygen_vk},
//     transcript::{Blake2bWrite, Challenge255},
// };
// use halo2_base::halo2_proofs::poly::kzg::multiopen::ProverSHPLONK;
// use rand_core::OsRng;
// use std::io::Cursor;
// use halo2_base::halo2_proofs::transcript::TranscriptWriterBuffer;
// use circuits::circuit::ScholarshipCircuit;
// use halo2_base::halo2_proofs::plonk::VerifyingKey;
// use crate::export_verifier::export_verifier;
// pub struct ProofOutput {
//     pub proof: Vec<u8>,
//     pub root: Fr,

//     pub nullifier: Fr,
//     pub params: ParamsKZG<Bn256>,
//     pub vk: VerifyingKey<G1Affine>,
// }


// pub fn generate_proof() -> ProofOutput {

//     let circuit_data = crate::inputs_builder::build_inputs();


//     // 1. build circuit (IMPORTANT)
//     let circuit = crate::inputs_builder::build_inputs();

//     // 2. convert sang Halo2 Circuit (KHÔNG dùng builder trực tiếp)
//     let circuit = circuit.to_circuit_ext();

//     // circuit.finalize();

//     // 3. KZG params
//     let params: ParamsKZG<Bn256> = ParamsKZG::setup(12, OsRng);
//     // let params = Params::<KZGCommitmentScheme<Bn256>>::setup(12, OsRng);

//     // 4. keygen
//     let vk = keygen_vk(&params, &circuit).unwrap();
//     // let vk_bytes = bincode::serialize(&vk).unwrap();

//     let mut vk_file = File::create("vk.bin").unwrap();
//     vk.write(&mut vk_file, halo2_base::halo2_proofs::SerdeFormat::RawBytes).unwrap();

//     let pk = keygen_pk(&params, vk.clone(), &circuit).unwrap();


   

//     // let public_inputs: &[&[Fr]] = &[
//     //     &[circuit_data.root],
//     //     &[circuit_data.nullifier],
//     // ];

//     // let public_inputs: &[&[Fr]] = &[
//     //     &[circuit_data.root, circuit_data.nullifier],
//     // ];

//     // let public_inputs = vec![
//     //     vec![circuit_data.root],
//     //     vec![circuit_data.nullifier],
//     // ];

//     // let public_inputs: &[&[&[Fr]]] = &[
//     //     &[&[circuit_data.root]],
//     //     &[&[circuit_data.nullifier]],
//     // ];

//     let col0 = [circuit_data.root];
//     let col1 = [circuit_data.nullifier];

//     // 2. Wrap them to represent [ Circuit_0 [ Column_0, Column_1 ] ]
//     let public_inputs: &[&[&[Fr]]] = &[
//         &[&col0, &col1]
//     ];

//     // 5. transcript
//     // let mut transcript = Blake2bWrite::<_, _, Challenge255<_>>::init(vec![]);
//     // let mut transcript = TranscriptWriterBuffer::<Vec<u8>, Bn256, Challenge255<Bn256>>::init(vec![]);
//         // TranscriptWriterBuffer::<_, _, Challenge255<_>>::init(vec![]);
//     let mut transcript = Blake2bWrite::<_, G1Affine, Challenge255<G1Affine>>::init(vec![]);

//     // 6. proof
//     // create_proof::<
//     //     KZGCommitmentScheme<Bn256>,
//     //     _,
//     //     Challenge255<G1Affine>,
//     //     OsRng,
//     //     Blake2bWrite<Vec<u8>, G1Affine, Challenge255<G1Affine>>,
//     //     _
//     // >(
//     //     &params,
//     //     &pk,
//     //     &[circuit],
//     //     public_inputs,
//     //     OsRng,
//     //     &mut transcript,
//     // ).unwrap();

//     // create_proof(
//     //     &params,
//     //     &pk,
//     //     &[circuit],
//     //     public_inputs,
//     //     OsRng,
//     //     &mut transcript,
//     // ).unwrap();

//     eprintln!("root = {:?}", circuit_data.root);
//     eprintln!("nullifier = {:?}", circuit_data.nullifier);

//     eprintln!("instances check:");
//     eprintln!("{:?}", public_inputs);


//     create_proof::<
//         KZGCommitmentScheme<Bn256>,
//         ProverSHPLONK<Bn256>,
//         Challenge255<G1Affine>,
//         OsRng,
//         Blake2bWrite<Vec<u8>, G1Affine, Challenge255<G1Affine>>,
//         _,
//     >(
//         &params,
//         &pk,
//         &[circuit],
//         public_inputs,
//         // &[public_inputs],
//         OsRng,
//         &mut transcript,
//     ).unwrap();

//         // create_proof::<
//     //     KZGCommitmentScheme<Bn256>,
//     //     _,
//     //     Challenge255<_>,
//     //     OsRng,
//     //     _,
//     //     _
//     // >(
//     //     &params,
//     //     &pk,
//     //     &[circuit],
//     //     public_inputs,
//     //     OsRng,
//     //     &mut transcript,
//     // ).unwrap();

//     let proof = transcript.finalize();

//     let json = json!({
//         "proof": hex::encode(&proof),
//         "root": format!("{:?}", circuit_data.root),
//         "nullifier": format!("{:?}", circuit_data.nullifier)
//     });

//     fs::write("proof.json", json.to_string()).unwrap();
 

//     // 7. extract public inputs từ circuit gốc
//     // let root = crate::inputs_builder::build_inputs().root;
//     // let nullifier = crate::inputs_builder::build_inputs().nullifier;

//     ProofOutput {
//         proof,
//         root: circuit_data.root,
//         nullifier: circuit_data.nullifier,
//         params,
//         vk,
//     }
// }










use std::fs;
use serde_json::json;
use halo2_base::halo2_proofs::{
    halo2curves::bn256::{Bn256, Fr, G1Affine},
    poly::kzg::commitment::ParamsKZG,
    plonk::{keygen_pk, keygen_vk},
};
// use rand_core::OsRng;
use rand_core::{OsRng, SeedableRng};
use rand_chacha::ChaCha20Rng;
// Thêm các thư viện transcript chuẩn EVM từ snark-verifier-sdk
use snark_verifier_sdk::{
    evm::{gen_evm_proof_shplonk},
    CircuitExt, SHPLONK,
};
use circuits::circuit::ScholarshipCircuit;
use snark_verifier::loader::evm::encode_calldata;
use ff_ce::hex;
use serde::Serialize;

// pub struct ProofOutput {
//     pub proof: Vec<u8>,
//     pub calldata:  Vec<u8>,
//     pub root: Fr,
//     pub nullifier: Fr,
//     pub params: ParamsKZG<Bn256>,
//     pub vk: halo2_base::halo2_proofs::plonk::VerifyingKey<G1Affine>,
// }

// use ff_ce::hex;

// pub fn generate_proof() -> ProofOutput {
//     // 1. Khởi tạo dữ liệu đầu vào
//     let circuit_data = crate::inputs_builder::build_inputs();

//     // 2. Chuyển đổi sang Circuit mở rộng hỗ trợ SDK
//     let circuit = circuit_data.to_circuit_ext();
    
//     // Lấy Public Inputs dạng phẳng từ mạch được định nghĩa bởi CircuitExt
//     let instances = circuit.instances(); 

//     // 3. Khởi tạo tham số KZG với bậc K=12
//     let params = ParamsKZG::<Bn256>::setup(12, OsRng);

//     // 4. Sinh Khóa cấu hình (VK và PK) đồng bộ hoàn toàn với mạch mở rộng
//     let vk = keygen_vk(&params, &circuit).expect("keygen_vk failed");
//     let pk = keygen_pk(&params, vk.clone(), &circuit).expect("keygen_pk failed");

//     eprintln!("🚀 Đang sinh Proof chuẩn tương thích EVM (SHPLONK)...");
    
//     // 5. Sử dụng hàm SDK để sinh Proof tích hợp sẵn EvmTranscript chuẩn hóa
//     let proof = gen_evm_proof_shplonk(&params, &pk, circuit, instances.clone());

//     // 6. Trích xuất chuỗi Hex chuyển xuống hardhat
//     let proof_hex = hex::encode(&proof);
    
//     let json = json!({
//         "proof": proof_hex,
//         "root": format!("{:?}", circuit_data.root),
//         "nullifier": format!("{:?}", circuit_data.nullifier)
//     });

//     fs::write("proof.json", json.to_string()).unwrap();
//     eprintln!("✅ Đã xuất file proof.json mới tương thích 100% với EVM Verifier!");

//     ProofOutput {
//         proof,
//         calldata,
//         root: circuit_data.root,
//         nullifier: circuit_data.nullifier,
//         params,
//         vk
//     }
// }

// Thêm trường calldata vào Struct đầu ra
pub struct ProofOutput {
    pub proof: Vec<u8>,
    pub calldata: Vec<u8>, // 🔴 Thêm dòng này
    pub root: Fr,
    pub nullifier: Fr,
    pub recipient: Fr,
    pub params: ParamsKZG<Bn256>,
    pub vk: halo2_base::halo2_proofs::plonk::VerifyingKey<G1Affine>,
}


pub struct VerifierSetupOutput {
    pub params:
        ParamsKZG<Bn256>,

    pub vk:
        halo2_base::
            halo2_proofs::
            plonk::
            VerifyingKey<G1Affine>,
}


#[derive(Serialize)]
pub struct PublicInputsOutput {
    pub root: String,

    pub nullifier: String,

    pub amount: String,
    pub recipient: String,
}


fn setup_fixed_params() -> ParamsKZG<Bn256> {
    let rng =
        ChaCha20Rng::from_seed(
            [42u8; 32]
        );

    // LAP20 — lay K tu cung mot nguon voi mach (bien HALO2_K, mac dinh 13).
    ParamsKZG::<Bn256>::setup(
        circuits::circuit::k_mach() as u32,
        rng
    )
}



// =========================
// VERIFIER SETUP ONLY
//
// INPUT:
// Note được truyền từ backend qua stdin.
//
// THỰC HIỆN:
// 1. Build circuit.
// 2. Tạo fixed KZG params.
// 3. Tạo verifying key.
//
// KHÔNG THỰC HIỆN:
// - Không tạo proving key.
// - Không tạo proof.
// - Không encode calldata.
// - Không ghi proof.json.
// =========================

pub fn prepare_verifier_setup()
    -> VerifierSetupOutput
{
    // Đọc note từ stdin và tạo
    // ScholarshipCircuit có cùng cấu trúc
    // với circuit dùng khi prove.
    let circuit_data =
        crate::
            flow_inputs::
            build_keygen_circuit();

    // Assign circuit layout để keygen VK.
    let builder =
        circuit_data
            .create_builder();

    // Dùng đúng fixed ParamsKZG:
    // K = 13
    // seed = [42; 32]
    let params =
        setup_fixed_params();

    // Chỉ tạo verifying key.
    // Không tạo proving key.
    let vk =
        keygen_vk(
            &params,
            &builder
        )
        .expect(
            "Khởi tạo VK thất bại"
        );

    eprintln!(
        "\n========================"
    );

    eprintln!(
        "VERIFIER SETUP PREPARED"
    );

    eprintln!(
        "NO PROOF WAS CREATED"
    );

    eprintln!(
        "========================"
    );

    VerifierSetupOutput {
        params,
        vk,
    }
}



// =========================
// COMPUTE PUBLIC INPUTS ONLY
//
// NO PROOF
// NO PK
// NO VK
// =========================

pub fn compute_public_inputs_only() {
    let circuit_data =
        crate::flow_inputs::
            build_inputs();

    let builder =
        circuit_data
            .create_builder();

    let instances:
        Vec<Vec<Fr>> =
        builder
            .assigned_instances
            .iter()
            .map(
                |column| {
                    column
                        .iter()
                        .map(
                            |assigned| {
                                *assigned
                                    .value()
                            }
                        )
                        .collect()
                }
            )
            .collect();

    if instances.len() != 4 {
        panic!(
            "Expected exactly 4 instance columns: root, nullifier, amount, recipient"
        );
    }

    if instances
        .iter()
        .any(
            |column| {
                column.len()
                    !=
                    1
            }
        )
    {
        panic!(
            "Each instance column must contain exactly one public input"
        );
    }

    // Không có proof.
    // Chỉ mã hóa instances theo đúng
    // format EVM của SDK.
    let empty_proof:
        Vec<u8> =
        Vec::new();

    let encoded =
        encode_calldata(
            &instances,
            &empty_proof
        );

    if encoded.len() < 128 {
        panic!(
            "Encoded public inputs must contain root, nullifier, amount and recipient"
        );
    }

    let output =
        PublicInputsOutput {
            root:
                format!(
                    "0x{}",
                    hex::encode(
                        &encoded[
                            0..32
                        ]
                    )
                ),

            nullifier:
                format!(
                    "0x{}",
                    hex::encode(
                        &encoded[
                            32..64
                        ]
                    )
                ),

            amount:
                format!(
                    "0x{}",
                    hex::encode(
                        &encoded[
                            64..96
                        ]
                    )
                ),
            recipient:
                format!(
                    "0x{}",
                    hex::encode(
                        &encoded[
                            96..128
                        ]
                    )
                ),
        };

    println!(
        "{}",
        serde_json::to_string(
            &output
        )
        .unwrap()
    );

    eprintln!(
        "\n========================"
    );

    eprintln!(
        "PUBLIC INPUTS COMPUTED"
    );

    eprintln!(
        "NO PROOF CREATED"
    );

    eprintln!(
        "========================"
    );

    eprintln!(
        "root = {}",
        output.root
    );

    eprintln!(
        "nullifier = {}",
        output.nullifier
    );

    eprintln!(
        "amount = {}",
        output.amount
    );
    eprintln!(
        "recipient = {}",
        output.recipient
    );
}




pub fn generate_proof() -> ProofOutput {
    let circuit_data = crate::flow_inputs::build_inputs();
    let builder = circuit_data.create_builder();
    
    let instances: Vec<Vec<Fr>> = builder
        .assigned_instances
        .iter()
        .map(|column| column.iter().map(|assigned| *assigned.value()).collect())
        .collect();

    // let params = ParamsKZG::<Bn256>::setup(12, OsRng);
    let params = setup_fixed_params();
    let vk = keygen_vk(&params, &builder).expect("Khởi tạo VK thất bại");
    let pk = keygen_pk(&params, vk.clone(), &builder).expect("Khởi tạo PK thất bại");

    eprintln!("🚀 Đang sinh Proof chuẩn tương thích EVM (SHPLONK)...");
    let proof = gen_evm_proof_shplonk(&params, &pk, builder, instances.clone());

    // Sinh khối bytes calldata hoàn chỉnh thông qua SDK
    let clean_calldata = encode_calldata(&instances, &proof);
    let calldata_hex = hex::encode(&clean_calldata);
    let proof_hex = hex::encode(&proof);



    // Ghi file JSON với tên trường rõ ràng
    // let json = json!({
    //     "proof": format!("0x{}", proof_hex),
    //     "calldata": format!("0x{}", calldata_hex),
    //     "root": format!("{:?}", circuit_data.expected_root),
    //     "nullifier": format!("{:?}", circuit_data.expected_nullifier)
    // });


    if clean_calldata.len() < 128 {
        panic!(
            "Calldata does not contain root, nullifier, amount and recipient"
        );
    }



    let root_hex =
        format!(
            "0x{}",
            hex::encode(
                &clean_calldata[0..32]
            )
        );

    let nullifier_hex =
        format!(
            "0x{}",
            hex::encode(
                &clean_calldata[32..64]
            )
        );

    
    let amount_hex =
        format!(
            "0x{}",
            hex::encode(
                &clean_calldata[
                    64..96
                ]
            )
        );
    // A25 — word thu 4 cua calldata la vi nhan.
    let recipient_hex =
        format!(
            "0x{}",
            hex::encode(
                &clean_calldata[
                    96..128
                ]
            )
        );

    

    // let json = json!({
    //     "proof": format!("0x{}", proof_hex),
    //     "calldata": format!("0x{}", calldata_hex),
    //     "root": root_hex,
    //     "nullifier": nullifier_hex
    // });


    let json = json!({
        "proof":
            format!(
                "0x{}",
                proof_hex
            ),

        "calldata":
            format!(
                "0x{}",
                calldata_hex
            ),

        "root":
            root_hex,

        "nullifier":
            nullifier_hex,

        "amount":
            amount_hex,
        "recipient":
            recipient_hex
    });



    // fs::write("proof.json", json.to_string()).unwrap();
    // eprintln!("✅ Đã xuất file proof.json chứa CALLDATA chuẩn hóa!");

    fs::write(
        "proof.json",
        json.to_string()
    ).unwrap();

    println!(
        "{}",
        json.to_string()
    );

    eprintln!(
        "✅ Đã xuất file proof.json chứa CALLDATA chuẩn hóa!"
    );

    ProofOutput {
        proof,
        calldata: clean_calldata, // 🔴 Trả về đúng trường
        root: circuit_data.expected_root,
        nullifier: circuit_data.expected_nullifier,
        recipient: circuit_data.recipient,
        params,
        vk
    }
}
