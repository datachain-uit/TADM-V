use halo2_base::{
    Context,
    gates::flex_gate::GateChip,
    AssignedValue,
    halo2_proofs::halo2curves::bn256::Fr,
};

use crate::{
    note::Note,
    poseidon::PoseidonChip,
};

pub struct CommitmentChip;

impl CommitmentChip {

    // =========================
    // CREATE COMMITMENT
    // =========================
    pub fn create_commitment(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,
        note: &Note,
    ) -> AssignedValue<Fr> {

        let inputs = note.to_vec();

        PoseidonChip::hash_note(
            ctx,
            gate,
            hasher,
            &inputs,
        )
    }

    // =========================
    // CREATE NULLIFIER
    // =========================
    pub fn create_nullifier(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,
        rho: AssignedValue<Fr>,
    ) -> AssignedValue<Fr> {

        PoseidonChip::hash_nullifier(
            ctx,
            gate,
            hasher,
            rho,
        )
    }

    // =========================
    // FULL NOTE COMMIT FLOW
    // =========================
    pub fn commit_note(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,
        note: Note,
    ) -> (AssignedValue<Fr>, AssignedValue<Fr>) {

        let commitment =
            Self::create_commitment(ctx, gate, hasher, &note);

        let nullifier =
            Self::create_nullifier(ctx, gate, hasher, note.rho);

        (commitment, nullifier)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use halo2_base::gates::circuit::builder::BaseCircuitBuilder;
    use crate::note::Note;

    #[test]
    fn test_commitment_flow() {

        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let mut ctx = builder.main(0);

        let gate = GateChip::<Fr>::new();

        let mut hasher =
            PoseidonChip::new_hasher();

        let student_id = ctx.load_witness(Fr::from(1));
        let amount = ctx.load_witness(Fr::from(100));
        let rho = ctx.load_witness(Fr::from(999));

        let note = Note {
            student_id,
            amount,
            rho,
        };

        let (commitment, nullifier) =
            CommitmentChip::commit_note(
                &mut ctx,
                &gate,
                &mut hasher,
                note,
            );

        builder.assigned_instances.push(vec![commitment]);

        eprintln!("commitment generated");
    }
}