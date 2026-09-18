use pasta_curves::pallas;
use crate::poseidon::{poseidon_hash_nullifier};
use crate::note::Note;

pub fn nullifier(note: &Note) -> pallas::Base {
    poseidon_hash_nullifier(note.rho)
}