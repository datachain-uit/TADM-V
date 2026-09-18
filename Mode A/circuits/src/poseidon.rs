use halo2_proofs::{
    // circuit::{Layouter, Value},
    // plonk::{Advice, Column, ConstraintSystem, Error, Fixed}
    plonk::{Advice, Column, ConstraintSystem}
};

use halo2_gadgets::poseidon::{
    primitives::{ConstantLength, Hash, P128Pow5T3},
    Pow5Chip,
    Pow5Config,
};


use pasta_curves::pallas;

#[derive(Clone, Debug)]
pub struct PoseidonConfig {
    pub state: [Column<Advice>; 3],
    pub pow5_config: Pow5Config<pallas::Base, 3, 2>
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

        let pow5_config = Pow5Chip::<pallas::Base, 3, 2>::configure::<P128Pow5T3>(
            meta, 
            state,
            partial_sbox,
            rc_a,
            rc_b
        );

        PoseidonConfig {state, pow5_config}
    }
}


pub fn poseidon_hash(a: pallas::Base, b: pallas::Base, c: pallas::Base) -> pallas::Base {
    let hasher = Hash::<
        // _,
        pallas::Base,
        P128Pow5T3,
        ConstantLength<3>,
        3,
        2,
    >::init();

    hasher.hash([a, b, c])
}


pub fn poseidon_hash_nullifier(rho: pallas::Base) -> pallas::Base {
    let hasher = Hash::<
        pallas::Base,
        P128Pow5T3,
        ConstantLength<1>,
        3,
        2
    >::init();
    hasher.hash([rho])
}

pub fn poseidon_hash_commitment(
    student_id: pallas::Base,
    scholarship_amount: pallas::Base,
    rho: pallas::Base,
) -> pallas::Base {
    let hasher = Hash::<
        pallas::Base,
        P128Pow5T3,
        ConstantLength<3>,
        3,
        2,
    >::init();

    hasher.hash([
        student_id,
        scholarship_amount,
        rho,
    ])
}

pub fn poseidon_hash_merkle(
    left: pallas::Base,
    right: pallas::Base,
) -> pallas::Base {
    let hasher = Hash::<
        pallas::Base,
        P128Pow5T3,
        ConstantLength<2>,
        3,
        2,
    >::init();

    hasher.hash([
        left,
        right,
    ])
}


// #[cfg(test)]
// mod tests {
//     use super::*;
//     use pasta_curves::pallas::Base as Fp;

//     #[test]
//     fn test_poseidon_hash() {
//         let h = poseidon_hash(
//             Fp::from(1),
//             Fp::from(2),
//             Fp::from(3)
//         );

//         println!("Poseidon hash = {:?}", h);
//     }
// }