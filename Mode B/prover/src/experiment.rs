use std::{fs, time::Instant};

use serde::Deserialize;
use serde_json::json;

use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;

use ff_ce::hex;

use halo2_base::halo2_proofs::{
    halo2curves::bn256::{Bn256, Fr, G1Affine},
    plonk::{create_proof, keygen_pk, keygen_vk, verify_proof},
    poly::commitment::ParamsProver,
    poly::kzg::commitment::KZGCommitmentScheme,
    poly::kzg::multiopen::{ProverSHPLONK, VerifierSHPLONK},
    poly::kzg::strategy::AccumulatorStrategy,
    poly::VerificationStrategy,
    transcript::{TranscriptReadBuffer, TranscriptWriterBuffer},
};

use rand_core::{OsRng, RngCore};

use snark_verifier::loader::evm::encode_calldata;
use snark_verifier::system::halo2::transcript::evm::EvmTranscript;

use circuits::{
    circuit::{k, ScholarshipCircuit},
    commitment::{native_note_commitment, native_nullifier},
    merkle_tree::MerkleTree,
    note::Note,
};

use crate::field::{decimal_to_field, recipient_to_field};
use crate::generate_proof::setup_fixed_params;

#[derive(Deserialize, Clone)]
pub struct ExperimentNoteInput {
    pub student_id: u64,
    pub amount: u64,
    pub rho: String,
}

#[derive(Deserialize, Clone)]
pub struct ExperimentStudentInput {
    pub student_index: usize,
    pub ganache_account_index: usize,
    pub address: String,
    pub student_id: u64,
    pub amount: u64,
    pub private_key: String,
    pub public_key: String,
    pub cid: String,
    pub preparation_ms: f64,
    pub note: ExperimentNoteInput,
}

#[derive(Deserialize, Clone)]
pub struct ExperimentDatasetInput {
    pub n: usize,
    pub merkle_depth: usize,
    pub school_account_index: usize,
    pub student_account_offset: usize,
    pub students: Vec<ExperimentStudentInput>,
}

fn read_dataset(dataset_path: &str) -> ExperimentDatasetInput {
    let raw = fs::read_to_string(dataset_path).expect("Cannot read experiment dataset file");

    serde_json::from_str(&raw).expect("Invalid experiment dataset JSON")
}

fn output_dir() -> String {
    std::env::var("BENCH_OUT_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "../experiments/results/quantitative".to_string())
}

fn warmup_count() -> usize {
    match std::env::var("BENCH_WARMUP") {
        Err(_) => 0,

        Ok(value) => value.trim().parse().unwrap_or_else(|_| panic!("BENCH_WARMUP is not a number: {:?}", value)),
    }
}

fn dataset_note(note: &ExperimentNoteInput) -> Note {
    Note { student_id: Fr::from(note.student_id), amount: Fr::from(note.amount), rho: decimal_to_field(&note.rho) }
}

pub fn build_experiment_tree(dataset: &ExperimentDatasetInput) -> (MerkleTree, Vec<Note>) {
    assert!(dataset.students.len() <= (1usize << dataset.merkle_depth), "Merkle tree depth is too small");

    let notes: Vec<Note> = dataset.students.iter().map(|student| dataset_note(&student.note)).collect();

    let mut tree = MerkleTree::new(dataset.merkle_depth);

    for note in notes.iter() {
        tree.insert(native_note_commitment(note));
    }

    (tree, notes)
}

pub fn build_circuit_from_tree(
    tree: &MerkleTree,
    notes: &[Note],
    target_index: usize,
    recipient: Fr,
) -> ScholarshipCircuit {
    assert!(target_index < notes.len(), "target_index out of range");

    let witness = tree.create_witness(target_index);

    let target_note = Note {
        student_id: notes[target_index].student_id,

        amount: notes[target_index].amount,

        rho: notes[target_index].rho,
    };

    let nullifier = native_nullifier(target_note.rho);

    ScholarshipCircuit::new(target_note, witness.clone(), witness.root, nullifier, recipient)
}

fn build_sample_circuit(dataset: &ExperimentDatasetInput) -> ScholarshipCircuit {
    let (tree, notes) = build_experiment_tree(dataset);

    build_circuit_from_tree(&tree, &notes, 0, recipient_to_field(&dataset.students[0].address))
}

fn extract_instances(builder: &halo2_base::gates::circuit::builder::BaseCircuitBuilder<Fr>) -> Vec<Vec<Fr>> {
    builder.assigned_instances.iter().map(|column| column.iter().map(|assigned| *assigned.value()).collect()).collect()
}

pub fn run_export_verifier_from_dataset(dataset_path: &str) {
    let dataset = read_dataset(dataset_path);

    println!("Exporting Halo2Verifier.sol from dataset: {}", dataset_path);

    println!("n = {}", dataset.n);

    println!("Merkle depth = {}", dataset.merkle_depth);

    println!("K = {}", k());

    let params = setup_fixed_params();

    let sample_builder = build_sample_circuit(&dataset).create_builder();

    let vk = keygen_vk(&params, &sample_builder).expect("keygen_vk failed");

    crate::export_verifier::export_verifier(&params, &vk);

    println!("Halo2Verifier.sol exported successfully.");
}

pub fn run_check_k(dataset_path: &str) {
    let dataset = read_dataset(dataset_path);

    let started = Instant::now();

    let sample_builder = build_sample_circuit(&dataset).create_builder();

    let params = setup_fixed_params();

    match keygen_vk(&params, &sample_builder) {
        Ok(_) => {
            println!(
                "{{\"k\":{},\"merkle_depth\":{},\"ok\":true,\"check_ms\":{:.3}}}",
                k(),
                dataset.merkle_depth,
                started.elapsed().as_secs_f64() * 1000.0
            );
        }

        Err(error) => {
            panic!("K = {} is too small for merkle_depth = {}: {:?}", k(), dataset.merkle_depth, error);
        }
    }
}

pub fn run_bench_from_dataset(dataset_path: &str) {
    fs::create_dir_all(output_dir()).unwrap();

    let dataset = read_dataset(dataset_path);

    println!("Running proof generation benchmark from dataset: {}", dataset_path);

    println!("n = {}", dataset.n);

    println!("Merkle depth = {}", dataset.merkle_depth);

    println!("K = {}", k());

    let sample_builder = build_sample_circuit(&dataset).create_builder();

    let t_setup = Instant::now();

    let params = setup_fixed_params();

    let vk = keygen_vk(&params, &sample_builder).expect("keygen_vk failed");

    let pk = keygen_pk(&params, vk.clone(), &sample_builder).expect("keygen_pk failed");

    let setup_ms = t_setup.elapsed().as_secs_f64() * 1000.0;

    let csv_path = format!("{}/performance_onchain_n{}.csv", output_dir(), dataset.n);

    let proofs_path = format!("{}/proofs_n{}.json", output_dir(), dataset.n);

    let mut csv = String::from(
        "mechanism,n,student_index,witness_ms,setup_ms,prove_ms,proof_generation_ms,verify_native_ms,verified,proof_bytes,calldata_bytes,root,nullifier\n",
    );

    let mut proofs_json = Vec::new();

    let tree_started = Instant::now();

    let (scenario_tree, scenario_notes) = build_experiment_tree(&dataset);

    let tree_build_once_ms = tree_started.elapsed().as_secs_f64() * 1000.0;

    println!("Merkle tree built once for the scenario: {:.1} ms", tree_build_once_ms);

    let warmup_runs = warmup_count();

    let total_runs = warmup_runs + dataset.students.len();

    for run in 0..total_runs {
        let is_warmup = run < warmup_runs;

        let student_index = if is_warmup { run % dataset.students.len() } else { run - warmup_runs };

        println!("Generating proof for student_index = {}{}", student_index, if is_warmup { " (warm-up)" } else { "" });

        let recipient = recipient_to_field(&dataset.students[student_index].address);

        let t_tree = Instant::now();

        let circuit_data = build_circuit_from_tree(&scenario_tree, &scenario_notes, student_index, recipient);

        let tree_and_witness_ms = t_tree.elapsed().as_secs_f64() * 1000.0;

        let t_witness_2 = Instant::now();

        let builder = circuit_data.create_builder();

        let instances = extract_instances(&builder);

        let witness_ms = tree_and_witness_ms + t_witness_2.elapsed().as_secs_f64() * 1000.0;

        let instances_ref: Vec<&[Fr]> = instances.iter().map(|x| x.as_slice()).collect();

        let t_prove = Instant::now();

        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let rng_prove = ChaCha20Rng::from_seed(seed);

        let proof = {
            let mut transcript = TranscriptWriterBuffer::<_, G1Affine, _>::init(Vec::new());

            create_proof::<KZGCommitmentScheme<Bn256>, ProverSHPLONK<'_, Bn256>, _, _, EvmTranscript<_, _, _, _>, _>(
                &params,
                &pk,
                &[builder],
                &[&instances_ref[..]],
                rng_prove,
                &mut transcript,
            )
            .expect("create_proof failed");

            transcript.finalize()
        };

        let prove_ms = t_prove.elapsed().as_secs_f64() * 1000.0;

        let t_verify = Instant::now();

        let verified = {
            let mut transcript = TranscriptReadBuffer::<_, G1Affine, _>::init(proof.as_slice());

            VerificationStrategy::<_, VerifierSHPLONK<'_, Bn256>>::finalize(
                verify_proof::<_, VerifierSHPLONK<'_, Bn256>, _, EvmTranscript<_, _, _, _>, _>(
                    params.verifier_params(),
                    pk.get_vk(),
                    AccumulatorStrategy::new(params.verifier_params()),
                    &[&instances_ref[..]],
                    &mut transcript,
                )
                .expect("verify_proof failed"),
            )
        };

        let verify_native_ms = t_verify.elapsed().as_secs_f64() * 1000.0;

        assert!(verified, "freshly generated proof FAILED native verify (student_index = {})", student_index);

        let calldata = encode_calldata(&instances, &proof);

        let calldata_hex = format!("0x{}", hex::encode(&calldata));

        let root_hex = format!("0x{}", hex::encode(&calldata[0..32]));

        let nullifier_hex = format!("0x{}", hex::encode(&calldata[32..64]));

        let recipient_hex = format!("0x{}", hex::encode(&calldata[96..128]));

        let proof_generation_ms = witness_ms + prove_ms;

        csv.push_str(&format!(
            "onchain,{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{},{}\n",
            dataset.n,
            student_index,
            witness_ms,
            setup_ms,
            prove_ms,
            proof_generation_ms,
            verify_native_ms,
            verified,
            proof.len(),
            calldata.len(),
            root_hex,
            nullifier_hex
        ));

        if is_warmup {
            continue;
        }

        proofs_json.push(json!({
            "mechanism": "onchain",
            "n": dataset.n,
            "student_index": student_index,
            "ganache_account_index": dataset.students[student_index].ganache_account_index,
            "address": dataset.students[student_index].address,
            "cid": dataset.students[student_index].cid,
            "student_id": dataset.students[student_index].student_id,
            "preparation_ms": dataset.students[student_index].preparation_ms,
            "witness_ms": witness_ms,
            "setup_ms": setup_ms,
            "prove_ms": prove_ms,
            "proof_generation_ms": proof_generation_ms,
            "verify_native_ms": verify_native_ms,
            "verified": verified,
            "proof_bytes": proof.len(),
            "calldata_bytes": calldata.len(),
            "calldata": calldata_hex,
            "root": root_hex,
            "nullifier": nullifier_hex,
            "recipient": recipient_hex
        }));
    }

    fs::write(csv_path, csv).unwrap();

    fs::write(proofs_path, serde_json::to_string_pretty(&proofs_json).unwrap()).unwrap();

    println!("Proof generation benchmark finished for n = {}", dataset.n);
}
