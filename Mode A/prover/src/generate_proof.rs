use std::fs;
use std::io::{self, Read};
use std::time::Instant;

use halo2_proofs::{
    circuit::Value,
    plonk::{create_proof, keygen_pk, keygen_vk, verify_proof, SingleVerifier},
    poly::commitment::Params,
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use pasta_curves::vesta;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};

use circuits::circuit::ScholarshipCircuit;

use crate::field::{field_to_hex, hex_to_field, recipient_to_field};
use crate::flow_inputs::{build_inputs, merkle_depth};

pub const DEFAULT_K: u32 = 9;

const PARAMS_PATH: &str = "../shared/params.bin";

pub fn k() -> u32 {
    match std::env::var("HALO2_K") {
        Err(_) => DEFAULT_K,

        Ok(value) => {
            let parsed: u32 = value.trim().parse().unwrap_or_else(|_| panic!("HALO2_K is not a number: {:?}", value));

            if !(4..=20).contains(&parsed) {
                panic!("HALO2_K must be in 4..=20: {}", parsed);
            }

            parsed
        }
    }
}

fn params_path() -> String {
    let current_k = k();

    if current_k == DEFAULT_K { PARAMS_PATH.to_string() } else { format!("../target/params_k{}.bin", current_k) }
}

pub fn shape_only_circuit() -> ScholarshipCircuit {
    ScholarshipCircuit {
        student_id: Value::unknown(),

        amount: Value::unknown(),

        rho: Value::unknown(),

        recipient: Value::unknown(),

        path_siblings: vec![Value::unknown(); merkle_depth()],

        path_directions: vec![false; merkle_depth()],
    }
}

pub fn load_or_create_params() -> Params<vesta::Affine> {
    if let Ok(bytes) = fs::read(params_path()) {
        if let Ok(params) = Params::read(&mut &bytes[..]) {
            if params.k() != k() {
                eprintln!(
                    "Params in {} are for K = {}, but K = {} is required — regenerating",
                    params_path(),
                    params.k(),
                    k()
                );
            } else {
                eprintln!("Params loaded from {}", params_path());

                return params;
            }
        } else {
            eprintln!("Params file is unreadable, regenerating");
        }
    }

    let params: Params<vesta::Affine> = Params::new(k());

    let mut bytes = Vec::new();

    params.write(&mut bytes).expect("Cannot serialize params");

    fs::write(params_path(), &bytes).expect("Cannot write the params file");

    eprintln!("Params generated and written to {}", params_path());

    params
}

#[derive(Serialize)]
pub struct SetupOutput {
    pub k: u32,

    pub merkle_depth: usize,

    pub params_file: String,

    pub params_bytes: usize,

    pub setup_ms: f64,
}

pub fn run_setup() {
    let started = Instant::now();

    let _ = fs::remove_file(params_path());

    let params = load_or_create_params();

    let _vk = keygen_vk(&params, &shape_only_circuit()).expect("keygen_vk failed with freshly generated params");

    let setup_ms = started.elapsed().as_secs_f64() * 1000.0;

    let params_bytes = fs::metadata(params_path()).map(|m| m.len() as usize).unwrap_or(0);

    let output =
        SetupOutput { k: k(), merkle_depth: merkle_depth(), params_file: params_path(), params_bytes, setup_ms };

    println!("{}", serde_json::to_string(&output).unwrap());

    eprintln!("SETUP COMPLETED - NO PROOF CREATED");
}

#[derive(Serialize)]
pub struct CheckKOutput {
    pub k: u32,

    pub merkle_depth: usize,

    pub ok: bool,

    pub check_ms: f64,
}

pub fn run_check_k() {
    let started = Instant::now();

    let params = load_or_create_params();

    let result = keygen_vk(&params, &shape_only_circuit());

    if let Err(error) = result {
        panic!("K = {} is too small for MERKLE_DEPTH = {}: {:?}", k(), merkle_depth(), error);
    }

    let output = CheckKOutput {
        k: k(),

        merkle_depth: merkle_depth(),

        ok: true,

        check_ms: started.elapsed().as_secs_f64() * 1000.0,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}

#[derive(Deserialize)]
struct VerifyRequest {
    proof: String,

    root: String,

    nullifier: String,

    amount: String,

    recipient: String,
}

#[derive(Serialize)]
pub struct VerifyOutput {
    pub verified: bool,

    pub setup_ms: f64,

    pub verify_ms: f64,
}

pub fn run_verify() {
    let mut input = String::new();

    io::stdin().read_to_string(&mut input).unwrap();

    if input.trim().is_empty() {
        panic!("Rust verify mode received empty stdin");
    }

    let request: VerifyRequest = serde_json::from_str(&input).unwrap_or_else(|error| {
        panic!("Invalid verify JSON: {:?}", error);
    });

    let proof_hex = request.proof.strip_prefix("0x").unwrap_or(&request.proof);

    let proof = hex::decode(proof_hex).expect("proof must be a hex string");

    let public_inputs = vec![
        hex_to_field(&request.root),
        hex_to_field(&request.nullifier),
        hex_to_field(&request.amount),
        recipient_to_field(&request.recipient),
    ];

    let setup_started = Instant::now();

    let params = load_or_create_params();

    let vk = keygen_vk(&params, &shape_only_circuit()).expect("keygen_vk failed");

    let setup_ms = setup_started.elapsed().as_secs_f64() * 1000.0;

    let verify_started = Instant::now();

    let mut transcript = Blake2bRead::<&[u8], vesta::Affine, Challenge255<vesta::Affine>>::init(&proof[..]);

    let strategy = SingleVerifier::new(&params);

    let result = verify_proof(&params, &vk, strategy, &[&[&public_inputs[..]]], &mut transcript);

    let verify_ms = verify_started.elapsed().as_secs_f64() * 1000.0;

    match result {
        Ok(()) => {
            let output = VerifyOutput { verified: true, setup_ms, verify_ms };

            println!("{}", serde_json::to_string(&output).unwrap());

            eprintln!("\n========================");

            eprintln!("OFF-CHAIN VERIFICATION OK");

            eprintln!("========================");

            eprintln!("setup_ms  = {:.3}", setup_ms);

            eprintln!("verify_ms = {:.3}", verify_ms);
        }

        Err(error) => {
            eprintln!("\n========================");

            eprintln!("OFF-CHAIN VERIFICATION FAILED");

            eprintln!("========================");

            eprintln!("verification error = {:?}", error);

            panic!("Proof was rejected by the native Halo2 verifier");
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct ProofOutput {
    pub proof: String,

    pub root: String,

    pub nullifier: String,

    pub amount: String,

    pub recipient: String,

    pub tree_and_witness_ms: f64,

    pub setup_ms: f64,

    pub prove_ms: f64,

    pub total_ms: f64,
}

pub fn run_prove() {
    let started_tree = Instant::now();

    let inputs = build_inputs();

    let circuit = ScholarshipCircuit {
        student_id: Value::known(inputs.note.student_id),

        amount: Value::known(inputs.note.amount),

        rho: Value::known(inputs.note.rho),

        recipient: Value::known(inputs.recipient),

        path_siblings: inputs.siblings.iter().map(|x| Value::known(*x)).collect(),

        path_directions: inputs.directions,
    };

    let tree_and_witness_ms = started_tree.elapsed().as_secs_f64() * 1000.0;

    let started_setup = Instant::now();

    let params: Params<vesta::Affine> = load_or_create_params();

    let vk = keygen_vk(&params, &circuit).unwrap();

    let vk_bytes = format!("{:?}", vk);

    fs::write("../shared/vk.txt", vk_bytes).unwrap();

    let pk = keygen_pk(&params, vk, &circuit).unwrap();

    let setup_ms = started_setup.elapsed().as_secs_f64() * 1000.0;

    let public_inputs = vec![vec![inputs.root, inputs.nullifier, inputs.note.amount, inputs.recipient]];

    eprintln!("Public root = {}", field_to_hex(inputs.root));

    eprintln!("Public nullifier = {}", field_to_hex(inputs.nullifier));

    eprintln!("Public amount = {}", field_to_hex(inputs.note.amount));

    eprintln!("Public recipient = {}", field_to_hex(inputs.recipient));

    let mut transcript = Blake2bWrite::<Vec<u8>, vesta::Affine, Challenge255<vesta::Affine>>::init(vec![]);

    let started_prove = Instant::now();

    create_proof(&params, &pk, &[circuit], &[&[&public_inputs[0]]], OsRng, &mut transcript).unwrap();

    let proof = transcript.finalize();

    let prove_ms = started_prove.elapsed().as_secs_f64() * 1000.0;

    eprintln!("\n========================");
    eprintln!("CREATE PROOF COMPLETED");
    eprintln!("========================");

    let proof_hex = hex::encode(&proof);
    eprintln!("proof bytes len = {}", proof.len());
    eprintln!("proof hex = 0x{}", proof_hex);

    let output = ProofOutput {
        proof: proof_hex,

        root: field_to_hex(inputs.root),

        nullifier: field_to_hex(inputs.nullifier),

        amount: field_to_hex(inputs.note.amount),

        recipient: field_to_hex(inputs.recipient),

        tree_and_witness_ms,

        setup_ms,

        prove_ms,

        total_ms: tree_and_witness_ms + setup_ms + prove_ms,
    };

    fs::write("../shared/proof.json", serde_json::to_string_pretty(&output).unwrap()).unwrap();

    fs::write("../shared/proof.bin", &proof).unwrap();

    println!("{}", serde_json::to_string(&output).unwrap());

    eprintln!("\n========================");
    eprintln!("REAL PROOF");
    eprintln!("========================");

    eprintln!("proof hex = 0x{}", output.proof);

    eprintln!("proof bytes len = {}", proof.len());
}
