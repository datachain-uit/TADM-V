use std::io::{self, Read};

use circuits::{
    circuit::ScholarshipCircuit,
    commitment::{native_note_commitment, native_nullifier},
    merkle_tree::{native_merkle_root, MerkleTree, MerkleWitness},
    note::Note,
};
use halo2_base::halo2_proofs::halo2curves::bn256::Fr;
use serde::Deserialize;

use crate::field::{
    decimal_input_to_field, decimal_to_field, field_to_hex, hex_to_field, random_field, recipient_to_field,
    DecimalInput,
};

pub const MERKLE_DEPTH: usize = 9;

#[derive(Deserialize)]
struct NoteRequest {
    student_id: u64,
    amount: DecimalInput,
    rho: String,
    #[serde(default)]
    expected_root: Option<String>,
    #[serde(default)]
    commitments: Vec<String>,
    #[serde(default)]
    merkle_index: Option<usize>,
    #[serde(default)]
    siblings: Vec<String>,
    #[serde(default)]
    directions: Vec<bool>,
    #[serde(default)]
    recipient: Option<String>,
}

#[derive(Deserialize)]
struct RootRequest {
    commitments: Vec<String>,
}

fn read_stdin() -> String {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("Unable to read prover stdin");

    if input.trim().is_empty() {
        panic!("Prover received empty stdin");
    }

    input
}

fn note_from_request(request: &NoteRequest) -> Note {
    Note {
        student_id: Fr::from(request.student_id),
        amount: decimal_input_to_field(&request.amount),
        rho: decimal_to_field(&request.rho),
    }
}

fn checked_tree(commitments: &[String]) -> (MerkleTree, Vec<Fr>) {
    if commitments.is_empty() {
        panic!("At least one approved commitment is required");
    }

    let capacity = 1usize << MERKLE_DEPTH;
    if commitments.len() > capacity {
        panic!("Merkle depth {} supports at most {} commitments", MERKLE_DEPTH, capacity);
    }

    let commitment_values: Vec<Fr> = commitments.iter().map(|commitment| hex_to_field(commitment)).collect();

    let mut tree = MerkleTree::new(MERKLE_DEPTH);
    for commitment in &commitment_values {
        tree.insert(*commitment);
    }

    (tree, commitment_values)
}

pub fn run_rho() {
    println!(
        "{}",
        serde_json::json!({
            "rho": field_to_hex(random_field())
        })
    );
}

pub fn run_commitment() {
    let request: NoteRequest = serde_json::from_str(&read_stdin()).expect("Invalid note JSON");
    let note = note_from_request(&request);
    let commitment = native_note_commitment(&note);

    println!(
        "{}",
        serde_json::json!({
            "commitment": field_to_hex(commitment)
        })
    );
}

pub fn run_nullifier() {
    let request: NoteRequest = serde_json::from_str(&read_stdin()).expect("Invalid note JSON");
    let note = note_from_request(&request);
    let nullifier = native_nullifier(note.rho);

    println!(
        "{}",
        serde_json::json!({
            "nullifier": field_to_hex(nullifier)
        })
    );
}

pub fn run_root() {
    let request: RootRequest = serde_json::from_str(&read_stdin()).expect("Invalid root JSON");
    let (tree, _) = checked_tree(&request.commitments);

    println!(
        "{}",
        serde_json::json!({
            "root": field_to_hex(tree.root()),
            "leaf_count": request.commitments.len(),
            "nodes": tree
                .nodes
                .iter()
                .map(|level| level.iter().map(|value| field_to_hex(*value)).collect::<Vec<String>>())
                .collect::<Vec<Vec<String>>>(),
            "zeros": tree.zeros.iter().map(|value| field_to_hex(*value)).collect::<Vec<String>>()
        })
    );
}

pub fn build_inputs() -> ScholarshipCircuit {
    let request: NoteRequest = serde_json::from_str(&read_stdin()).expect("Invalid proof input JSON");
    let note = note_from_request(&request);
    let witness_commitment = native_note_commitment(&note);
    let index = request.merkle_index.expect("merkle_index is required in prove mode");

    let has_stored_path = request.siblings.len() == MERKLE_DEPTH && request.directions.len() == MERKLE_DEPTH;

    let witness = if has_stored_path {
        eprintln!("Merkle path read from merkleNodes - tree not rebuilt");

        MerkleWitness {
            leaf: witness_commitment,
            siblings: request.siblings.iter().map(|value| hex_to_field(value)).collect(),
            directions: request.directions.clone(),
            root: witness_commitment,
        }
    } else {
        let (tree, commitment_values) = checked_tree(&request.commitments);

        if index >= commitment_values.len() {
            panic!("merkle_index is outside the approved commitment list");
        }
        if commitment_values[index] != witness_commitment {
            eprintln!(
                "WARNING: the commitment at merkle_index does not match the decrypted note. \
                 The proof is still created; rejecting it is the job of the on-chain layer."
            );
        }

        eprintln!("Local Merkle root        = {}", field_to_hex(tree.root()));

        tree.create_witness(index)
    };

    let expected_root_hex = request.expected_root.as_deref().expect("expected_root is required in prove mode");
    let expected_root = hex_to_field(expected_root_hex);
    let nullifier = native_nullifier(note.rho);

    let witness_path_root = native_merkle_root(witness_commitment, &witness);

    if witness_path_root != expected_root {
        eprintln!(
            "WARNING: the root built from the note does not match currentRoot on the smart contract. \
             The proof is still created; rejecting it is the job of the on-chain layer."
        );
    }

    eprintln!("Approved commitment count = {}", if has_stored_path { 0 } else { request.commitments.len() });
    eprintln!("Merkle index = {}", index);
    eprintln!("Root from smart contract = {}", field_to_hex(expected_root));
    eprintln!("Root from witness path   = {}", field_to_hex(witness_path_root));
    eprintln!("Public nullifier = {}", field_to_hex(nullifier));

    let recipient = recipient_to_field(request.recipient.as_deref().expect("recipient is required in prove mode"));
    eprintln!("Public recipient = {}", field_to_hex(recipient));
    ScholarshipCircuit::new(note, witness, witness_path_root, nullifier, recipient)
}

pub fn build_keygen_circuit() -> ScholarshipCircuit {
    let note = Note { student_id: Fr::from(1), amount: Fr::from(1), rho: Fr::from(1) };
    let second_note = Note { student_id: Fr::from(2), amount: Fr::from(2), rho: Fr::from(2) };

    let mut tree = MerkleTree::new(MERKLE_DEPTH);
    tree.insert(native_note_commitment(&note));
    tree.insert(native_note_commitment(&second_note));
    let witness = tree.create_witness(0);
    let nullifier = native_nullifier(note.rho);

    ScholarshipCircuit::new(note, witness.clone(), witness.root, nullifier, Fr::from(0))
}
