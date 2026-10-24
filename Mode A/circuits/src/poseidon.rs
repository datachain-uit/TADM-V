use halo2_proofs::{
    plonk::{Advice, Column, ConstraintSystem},
};

use halo2_gadgets::poseidon::{
    primitives::{ConstantLength, Hash, P128Pow5T3},
    Pow5Chip, Pow5Config,
};

use pasta_curves::pallas;

#[derive(Clone, Debug)]
pub struct PoseidonConfig {
    pub state: [Column<Advice>; 3],
    pub pow5_config: Pow5Config<pallas::Base, 3, 2>,
}

pub struct PoseidonChip;

impl PoseidonChip {
    pub fn configure(meta: &mut ConstraintSystem<pallas::Base>) -> PoseidonConfig {
        let state = [meta.advice_column(), meta.advice_column(), meta.advice_column()];
        let partial_sbox = meta.advice_column();

        let rc_a = [meta.fixed_column(), meta.fixed_column(), meta.fixed_column()];
        let rc_b = [meta.fixed_column(), meta.fixed_column(), meta.fixed_column()];

        for column in state.iter() {
            meta.enable_equality(*column);
        }

        let pow5_config =
            Pow5Chip::<pallas::Base, 3, 2>::configure::<P128Pow5T3>(meta, state, partial_sbox, rc_a, rc_b);

        PoseidonConfig { state, pow5_config }
    }
}

pub fn poseidon_hash_nullifier(rho: pallas::Base) -> pallas::Base {
    let hasher = Hash::<pallas::Base, P128Pow5T3, ConstantLength<1>, 3, 2>::init();
    hasher.hash([rho])
}

pub fn poseidon_hash_commitment(student_id: pallas::Base, amount: pallas::Base, rho: pallas::Base) -> pallas::Base {
    let hasher = Hash::<pallas::Base, P128Pow5T3, ConstantLength<3>, 3, 2>::init();

    hasher.hash([student_id, amount, rho])
}

pub fn poseidon_hash_merkle(left: pallas::Base, right: pallas::Base) -> pallas::Base {
    let hasher = Hash::<pallas::Base, P128Pow5T3, ConstantLength<2>, 3, 2>::init();

    hasher.hash([left, right])
}
