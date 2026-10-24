use pasta_curves::pallas::Base as Fp;

use crate::note::Note;
use crate::poseidon::{poseidon_hash_commitment, poseidon_hash_nullifier};

pub fn native_commitment(student_id: Fp, amount: Fp, rho: Fp) -> Fp {
    poseidon_hash_commitment(student_id, amount, rho)
}

pub fn native_note_commitment(note: &Note) -> Fp {
    native_commitment(note.student_id, note.amount, note.rho)
}

pub fn native_nullifier(rho: Fp) -> Fp {
    poseidon_hash_nullifier(rho)
}
