use pasta_curves::pallas::Base as Fp;
use crate::poseidon::{poseidon_hash_commitment};

pub fn commitment(student_id: Fp, scholarship_amount: Fp, rho: Fp) -> Fp {
    poseidon_hash_commitment(student_id, scholarship_amount, rho)
}


