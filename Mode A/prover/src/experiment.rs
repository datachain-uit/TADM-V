use std::io::Read;
use std::time::Instant;

use halo2_proofs::{
    circuit::Value,
    plonk::{create_proof, keygen_pk, keygen_vk, verify_proof, SingleVerifier},
    poly::commitment::Params,
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use pasta_curves::vesta;
use rand_core::OsRng;
use serde::Serialize;

use circuits::circuit::ScholarshipCircuit;

use crate::field::field_to_hex;
use crate::flow_inputs::{build_inputs_from, merkle_depth, NoteRequest};
use crate::generate_proof::{k, load_or_create_params, shape_only_circuit};

#[derive(Serialize)]
pub struct BatchProofItem {
    pub student_index: usize,
    pub tree_and_witness_ms: f64,
    pub prove_ms: f64,
    pub verify_native_ms: f64,
    pub verified: bool,
    pub proof: String,
    pub root: String,
    pub nullifier: String,
    pub amount: String,
    pub recipient: String,
    pub proof_bytes: usize,
}

#[derive(Serialize)]
pub struct BatchOutput {
    pub setup_ms: f64,
    pub k: u32,
    pub merkle_depth: usize,
    pub student_count: usize,
    pub proofs: Vec<BatchProofItem>,
}

pub fn run_prove_batch() {
    let mut raw = String::new();

    std::io::stdin().read_to_string(&mut raw).expect("Cannot read stdin");

    if raw.trim().is_empty() {
        panic!("prove-batch received empty stdin");
    }

    let students: Vec<NoteRequest> = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("prove-batch expects a JSON array of students: {}", error));

    if students.is_empty() {
        panic!("prove-batch received an empty array");
    }

    let student_count = students.len();

    eprintln!("prove-batch: {} students, K = {}, merkle_depth = {}", student_count, k(), merkle_depth());

    let started_setup = Instant::now();

    let params: Params<vesta::Affine> = load_or_create_params();

    let shape = shape_only_circuit();

    let vk = keygen_vk(&params, &shape).expect("keygen_vk failed");

    let pk = keygen_pk(&params, vk.clone(), &shape).expect("keygen_pk failed");

    let setup_ms = started_setup.elapsed().as_secs_f64() * 1000.0;

    eprintln!("prove-batch: setup_ms = {:.1} ms (once for the whole run)", setup_ms);

    let mut items: Vec<BatchProofItem> = Vec::with_capacity(student_count);

    for (student_index, student) in students.into_iter().enumerate() {
        let started_tree = Instant::now();

        let inputs = build_inputs_from(student);

        let circuit = ScholarshipCircuit {
            student_id: Value::known(inputs.note.student_id),
            amount: Value::known(inputs.note.amount),
            rho: Value::known(inputs.note.rho),
            recipient: Value::known(inputs.recipient),
            path_siblings: inputs.siblings.iter().map(|x| Value::known(*x)).collect(),
            path_directions: inputs.directions.clone(),
        };

        let tree_and_witness_ms = started_tree.elapsed().as_secs_f64() * 1000.0;

        let public_inputs = vec![inputs.root, inputs.nullifier, inputs.note.amount, inputs.recipient];

        let mut transcript = Blake2bWrite::<Vec<u8>, vesta::Affine, Challenge255<vesta::Affine>>::init(vec![]);

        let started_prove = Instant::now();

        create_proof(&params, &pk, &[circuit], &[&[&public_inputs[..]]], OsRng, &mut transcript)
            .expect("create_proof failed");

        let proof = transcript.finalize();

        let prove_ms = started_prove.elapsed().as_secs_f64() * 1000.0;

        let started_verify = Instant::now();

        let mut read_transcript = Blake2bRead::<&[u8], vesta::Affine, Challenge255<vesta::Affine>>::init(&proof[..]);

        let verified = verify_proof(
            &params,
            pk.get_vk(),
            SingleVerifier::new(&params),
            &[&[&public_inputs[..]]],
            &mut read_transcript,
        )
        .is_ok();

        let verify_native_ms = started_verify.elapsed().as_secs_f64() * 1000.0;

        assert!(verified, "freshly generated proof FAILED native verify (student_index = {})", student_index);

        items.push(BatchProofItem {
            student_index,
            tree_and_witness_ms,
            prove_ms,
            verify_native_ms,
            verified,
            proof: hex::encode(&proof),
            root: field_to_hex(inputs.root),
            nullifier: field_to_hex(inputs.nullifier),
            amount: field_to_hex(inputs.note.amount),
            recipient: field_to_hex(inputs.recipient),
            proof_bytes: proof.len(),
        });
    }

    let output = BatchOutput { setup_ms, k: k(), merkle_depth: merkle_depth(), student_count, proofs: items };

    println!("{}", serde_json::to_string_pretty(&output).expect("Cannot serialize the prove-batch result"));
}
