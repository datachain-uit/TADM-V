use halo2_base::{
    gates::{circuit::builder::BaseCircuitBuilder, flex_gate::GateChip},
    halo2_proofs::halo2curves::bn256::Fr,
    AssignedValue, Context,
};

use crate::{
    note::{AssignedNote, Note},
    poseidon::PoseidonChip,
};

pub struct CommitmentChip;

impl CommitmentChip {
    pub fn create_commitment(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,
        note: &AssignedNote,
    ) -> AssignedValue<Fr> {
        let inputs = note.to_vec();

        PoseidonChip::hash_note(ctx, gate, hasher, &inputs)
    }

    pub fn create_nullifier(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,
        rho: AssignedValue<Fr>,
    ) -> AssignedValue<Fr> {
        PoseidonChip::hash_nullifier(ctx, gate, hasher, rho)
    }
}

pub fn native_note_commitment(note: &Note) -> Fr {
    let mut builder = BaseCircuitBuilder::<Fr>::new(false);
    let mut ctx = builder.main(0);
    let gate = GateChip::<Fr>::new();
    let mut hasher = PoseidonChip::new_hasher();

    let note_assigned = AssignedNote {
        student_id: ctx.load_witness(note.student_id),
        amount: ctx.load_witness(note.amount),
        rho: ctx.load_witness(note.rho),
    };

    let commitment = CommitmentChip::create_commitment(&mut ctx, &gate, &mut hasher, &note_assigned);

    *commitment.value()
}

pub fn native_commitment(student_id: Fr, amount: Fr, rho: Fr) -> Fr {
    native_note_commitment(&Note { student_id, amount, rho })
}

pub fn native_nullifier(rho: Fr) -> Fr {
    let mut builder = BaseCircuitBuilder::<Fr>::new(false);
    let mut ctx = builder.main(0);
    let gate = GateChip::<Fr>::new();
    let mut hasher = PoseidonChip::new_hasher();

    let rho_assigned = ctx.load_witness(rho);
    let nullifier = CommitmentChip::create_nullifier(&mut ctx, &gate, &mut hasher, rho_assigned);

    *nullifier.value()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commitment_flow() {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let mut ctx = builder.main(0);

        let gate = GateChip::<Fr>::new();

        let mut hasher = PoseidonChip::new_hasher();

        let student_id = ctx.load_witness(Fr::from(1));
        let amount = ctx.load_witness(Fr::from(100));
        let rho = ctx.load_witness(Fr::from(999));

        let note = AssignedNote { student_id, amount, rho };

        let commitment = CommitmentChip::create_commitment(&mut ctx, &gate, &mut hasher, &note);

        let _nullifier = CommitmentChip::create_nullifier(&mut ctx, &gate, &mut hasher, note.rho);

        builder.assigned_instances.push(vec![commitment]);

        eprintln!("commitment generated");
    }

    #[test]
    fn note_commitment_matches_field_commitment() {
        let note = Note { student_id: Fr::from(1), amount: Fr::from(100), rho: Fr::from(999) };

        assert_eq!(native_note_commitment(&note), native_commitment(note.student_id, note.amount, note.rho));
    }
}
