// use halo2_proofs::plonk::{Advice, Column, ConstraintSystem, Instance, Fixed};
// use halo2_proofs::plonk::{Column, ConstraintSystem, Instance, Fixed, Advice, poly::{Rotation, Expression}};
use crate::poseidon::{PoseidonConfig, PoseidonChip};
// use pasta_curves::Fp;

use halo2_proofs::{
    plonk::{
        Advice,
        Column,
        ConstraintSystem,
        Expression,
        Fixed,
        Instance,
        Selector,
    },
    poly::Rotation,
};

use pasta_curves::pallas::Base as Fp;

#[derive(Clone, Debug)]
pub struct Config {
    // pub advice: Column<Advice>,
    pub instance: Column<Instance>,
    pub constant: Column<Fixed>,
    pub poseidon: PoseidonConfig,

    pub merkle_current: Column<Advice>,
    pub merkle_sibling: Column<Advice>,
    pub merkle_direction: Column<Advice>,
    pub merkle_left: Column<Advice>,
    pub merkle_right: Column<Advice>,
    pub q_merkle_select: Selector

  
}

impl Config {
    pub fn configure(meta: &mut ConstraintSystem<pasta_curves::pallas::Base>) -> Self {
        // let advice = meta.advice_column();
        let instance = meta.instance_column();
        let constant = meta.fixed_column();
        // meta.enable_equality(advice);
        meta.enable_equality(instance);
        meta.enable_constant(constant);
        let poseidon = PoseidonChip::configure(meta);
        // Config { advice, instance, constant, poseidon }

        let merkle_current = meta.advice_column();
        let merkle_sibling = meta.advice_column();
        let merkle_direction = meta.advice_column();
        let merkle_left = meta.advice_column();
        let merkle_right = meta.advice_column();

        for column in [
            merkle_current,
            merkle_sibling,
            merkle_direction,
            merkle_left,
            merkle_right
        ] {
            meta.enable_equality(column)
        }

        let q_merkle_select = meta.selector();


        meta.create_gate(
            "merkle direction select",

            |meta| {
                let q =
                    meta.query_selector(
                        q_merkle_select
                    );


                let current =
                    meta.query_advice(
                        merkle_current,
                        Rotation::cur(),
                    );

                let sibling =
                    meta.query_advice(
                        merkle_sibling,
                        Rotation::cur(),
                    );

                let direction =
                    meta.query_advice(
                        merkle_direction,
                        Rotation::cur(),
                    );

                let left =
                    meta.query_advice(
                        merkle_left,
                        Rotation::cur(),
                    );

                let right =
                    meta.query_advice(
                        merkle_right,
                        Rotation::cur(),
                    );


                let one =
                    Expression::Constant(
                        Fp::from(1)
                    );


                // Constraint 1:
                //
                // direction phải là 0 hoặc 1.
                //
                // d(d - 1) = 0
                let direction_is_boolean =
                    direction.clone()
                        * (
                            direction.clone()
                                - one
                        );


                // Nếu d = 0:
                // left = current
                //
                // Nếu d = 1:
                // left = sibling
                let expected_left =
                    current.clone()
                        + direction.clone()
                            * (
                                sibling.clone()
                                    - current.clone()
                            );


                // Nếu d = 0:
                // right = sibling
                //
                // Nếu d = 1:
                // right = current
                let expected_right =
                    sibling.clone()
                        + direction.clone()
                            * (
                                current
                                    - sibling
                            );


                vec![
                    // d chỉ được là 0 hoặc 1
                    q.clone()
                        * direction_is_boolean,

                    // left phải được chọn đúng
                    q.clone()
                        * (
                            left
                                - expected_left
                        ),

                    // right phải được chọn đúng
                    q
                        * (
                            right
                                - expected_right
                        ),
                ]
            },
        );


        Config { instance, constant, poseidon, merkle_current, merkle_sibling, merkle_direction, merkle_left, merkle_right, q_merkle_select, }
    }
}