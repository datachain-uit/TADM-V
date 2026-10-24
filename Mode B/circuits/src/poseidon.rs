use halo2_base::{
    gates::flex_gate::GateChip,
    halo2_proofs::halo2curves::bn256::Fr,
    poseidon::hasher::{spec::OptimizedPoseidonSpec, PoseidonHasher},
    AssignedValue, Context,
};

pub struct PoseidonChip;

impl PoseidonChip {
    pub fn new_hasher() -> PoseidonHasher<Fr, 3, 2> {
        let spec = OptimizedPoseidonSpec::<Fr, 3, 2>::new::<8, 57, 0>();
        PoseidonHasher::<Fr, 3, 2>::new(spec)
    }

    pub fn hash_note(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut PoseidonHasher<Fr, 3, 2>,
        note: &[AssignedValue<Fr>],
    ) -> AssignedValue<Fr> {
        hasher.initialize_consts(ctx, gate);

        hasher.hash_fix_len_array(ctx, gate, note)
    }

    pub fn hash_nullifier(
        ctx: &mut Context<Fr>,
        gate: &GateChip<Fr>,
        hasher: &mut PoseidonHasher<Fr, 3, 2>,
        rho: AssignedValue<Fr>,
    ) -> AssignedValue<Fr> {
        hasher.initialize_consts(ctx, gate);

        hasher.hash_fix_len_array(ctx, gate, &vec![rho])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commitment::CommitmentChip;
    use crate::note::AssignedNote;
    use halo2_base::gates::{circuit::builder::BaseCircuitBuilder, GateInstructions};

    #[test]
    fn poseidon_chip_builds_commitment_constraint() {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let mut ctx = builder.main(0);

        let gate = GateChip::<Fr>::new();

        let mut hasher = PoseidonChip::new_hasher();

        let a = ctx.load_witness(Fr::from(10));
        let b = ctx.load_witness(Fr::from(20));
        let c = ctx.load_witness(Fr::from(30));

        let note = AssignedNote { student_id: a, amount: b, rho: c };

        let note_input = note.to_vec();

        let failure_note = AssignedNote { student_id: a, amount: ctx.load_witness(Fr::from(999)), rho: c };

        let commitment = PoseidonChip::hash_note(&mut ctx, &gate, &mut hasher, &note_input);

        let public_commitment = CommitmentChip::create_commitment(&mut ctx, &gate, &mut hasher, &failure_note);

        let is_equal = gate.is_equal(&mut ctx, commitment, public_commitment);

        gate.assert_is_const(&mut ctx, &is_equal, &Fr::one());
        eprintln!("constraint added: circuit_hash == public_hash");
    }
}
