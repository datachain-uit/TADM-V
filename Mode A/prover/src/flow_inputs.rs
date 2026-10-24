use std::io::{self, Read};

use circuits::{
    commitment::{native_commitment, native_note_commitment, native_nullifier},
    merkle_tree::{native_merkle_root, MerkleTree},
    note::Note,
};
use pasta_curves::pallas::Base as Fp;
use serde::{Deserialize, Serialize};

use crate::field::{decimal_to_field, field_to_hex, hex_to_field, random_field, recipient_to_field};

pub const DEFAULT_MERKLE_DEPTH: usize = 9;

pub fn merkle_depth() -> usize {
    match std::env::var("MERKLE_DEPTH") {
        Err(_) => DEFAULT_MERKLE_DEPTH,

        Ok(value) => {
            let depth: usize =
                value.trim().parse().unwrap_or_else(|_| panic!("MERKLE_DEPTH is not a number: {:?}", value));

            if depth == 0 || depth > 32 {
                panic!("MERKLE_DEPTH must be in 1..=32: {}", depth);
            }

            depth
        }
    }
}

#[derive(Deserialize)]
pub struct NoteRequest {
    student_id: u64,

    amount: String,

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

pub struct CircuitInputs {
    pub note: Note,
    pub root: Fp,
    pub nullifier: Fp,
    pub siblings: Vec<Fp>,
    pub directions: Vec<bool>,
    pub recipient: Fp,
}

#[derive(Serialize, Deserialize)]
pub struct CommitmentOutput {
    pub commitment: String,
}

#[derive(Serialize, Deserialize)]
pub struct NullifierOutput {
    pub nullifier: String,
}

#[derive(Serialize, Deserialize)]
pub struct RootOutput {
    pub root: String,

    pub leaf_count: usize,

    pub nodes: Vec<Vec<String>>,

    pub zeros: Vec<String>,
}

fn read_note_request() -> NoteRequest {
    let mut input = String::new();

    io::stdin().read_to_string(&mut input).unwrap();

    if input.trim().is_empty() {
        panic!("Rust received empty stdin");
    }

    serde_json::from_str(&input).unwrap_or_else(|error| {
        panic!("Invalid student JSON: {:?}", error);
    })
}

fn note_from_request(request: &NoteRequest) -> Note {
    Note::new(Fp::from(request.student_id), decimal_to_field(&request.amount), decimal_to_field(&request.rho))
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
    let note = note_from_request(&read_note_request());

    let commitment_value = native_commitment(note.student_id, note.amount, note.rho);

    let output = CommitmentOutput { commitment: field_to_hex(commitment_value) };

    println!("{}", serde_json::to_string(&output).unwrap());

    eprintln!("COMMITMENT COMPUTED");
}

pub fn run_nullifier() {
    let note = note_from_request(&read_note_request());

    let nullifier_value = native_nullifier(note.rho);

    let output = NullifierOutput { nullifier: field_to_hex(nullifier_value) };

    println!("{}", serde_json::to_string(&output).unwrap());

    eprintln!("NULLIFIER COMPUTED - NO PROOF CREATED");
}

pub fn run_root() {
    let mut input = String::new();

    io::stdin().read_to_string(&mut input).unwrap();

    if input.trim().is_empty() {
        panic!("Rust root mode received empty stdin");
    }

    let request: RootRequest = serde_json::from_str(&input).unwrap_or_else(|error| {
        panic!("Invalid root JSON: {:?}", error);
    });

    if request.commitments.is_empty() {
        panic!("Cannot build root from empty commitments");
    }

    let maximum_leaves = 1usize << merkle_depth();

    if request.commitments.len() > maximum_leaves {
        panic!("Merkle depth {} supports at most {} leaves", merkle_depth(), maximum_leaves);
    }

    let mut tree = MerkleTree::new(merkle_depth());

    for commitment_hex in &request.commitments {
        tree.insert(hex_to_field(commitment_hex));
    }

    let root = tree.root();

    let output = RootOutput {
        root: field_to_hex(root),

        leaf_count: request.commitments.len(),

        nodes: tree.nodes.iter().map(|level| level.iter().map(|value| field_to_hex(*value)).collect()).collect(),

        zeros: tree.zeros.iter().map(|value| field_to_hex(*value)).collect(),
    };

    println!("{}", serde_json::to_string(&output).unwrap());

    eprintln!("ROOT COMPUTED FROM MONGODB COMMITMENTS");

    eprintln!("leaf count = {}", output.leaf_count);

    eprintln!("root = {}", output.root);
}

pub fn build_inputs() -> CircuitInputs {
    build_inputs_from(read_note_request())
}

pub fn build_inputs_from(request: NoteRequest) -> CircuitInputs {
    let recipient = recipient_to_field(
        request.recipient.as_deref().unwrap_or_else(|| panic!("recipient is required in prove mode")),
    );

    let note = note_from_request(&request);

    let witness_commitment = native_note_commitment(&note);

    eprintln!("Witness commitment = {}", field_to_hex(witness_commitment));

    let has_stored_path = request.siblings.len() == merkle_depth() && request.directions.len() == merkle_depth();

    let index = request.merkle_index.expect("merkle_index is required in prove mode");

    let (root, siblings, directions, commitment_count) = if has_stored_path {
        let path_siblings: Vec<Fp> = request.siblings.iter().map(|value| hex_to_field(value)).collect();

        let path_directions: Vec<bool> = request.directions.clone();

        let path_root = native_merkle_root(witness_commitment, &path_siblings, &path_directions);

        eprintln!("Merkle path read from merkleNodes - tree not rebuilt");

        (path_root, path_siblings, path_directions, 0usize)
    } else {
        if request.commitments.is_empty() {
            panic!("No approved commitments supplied from MongoDB");
        }

        let maximum_leaves = 1usize << merkle_depth();

        if request.commitments.len() > maximum_leaves {
            panic!("Merkle depth {} supports at most {} leaves", merkle_depth(), maximum_leaves);
        }

        let commitments: Vec<Fp> = request.commitments.iter().map(|value| hex_to_field(value)).collect();

        if index >= commitments.len() {
            panic!("merkle_index {} exceeds commitment count {}", index, commitments.len());
        }

        if commitments[index] != witness_commitment {
            eprintln!(
                "WARNING: the commitment at merkle_index does not match the decrypted note. \
                 The proof is still created; rejecting it is the job of the verify step."
            );
        }

        let mut tree = MerkleTree::new(merkle_depth());

        for commitment_value in &commitments {
            tree.insert(*commitment_value);
        }

        let (path_siblings, path_directions) = tree.get_path(index);

        (tree.root(), path_siblings, path_directions, commitments.len())
    };

    eprintln!("Common Merkle root = {}", field_to_hex(root));
    eprintln!("Proof student index = {}", index);

    eprintln!("Number of approved commitments = {}", commitment_count);
    eprintln!("Path directions = {:?}", directions);
    eprintln!("Path sibling count = {}", siblings.len());

    let witness_path_root = native_merkle_root(witness_commitment, &siblings, &directions);

    if let Some(expected_root_hex) = request.expected_root.as_ref() {
        let expected_root = hex_to_field(expected_root_hex);

        eprintln!("Local Merkle root        = {}", field_to_hex(root));

        eprintln!("Root from smart contract = {}", field_to_hex(expected_root));

        eprintln!("Root from witness path   = {}", field_to_hex(witness_path_root));

        if witness_path_root != expected_root {
            eprintln!(
                "WARNING: the root built from the note does not match currentRoot on the smart contract. \
                 The proof is still created; rejecting it is the job of the verify step."
            );
        }
    }

    let nullifier = native_nullifier(note.rho);
    eprintln!("Public nullifier computed");

    CircuitInputs { note, root: witness_path_root, nullifier, siblings, directions, recipient }
}
