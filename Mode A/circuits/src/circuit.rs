use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    plonk::{Advice, Circuit, Column, ConstraintSystem, Error, Expression, Fixed, Instance, Selector},
    poly::Rotation,
};

use halo2_gadgets::poseidon::{
    primitives::{ConstantLength, P128Pow5T3},
    Hash, Pow5Chip,
};

use pasta_curves::Fp;

use crate::poseidon::{PoseidonChip, PoseidonConfig};

#[derive(Clone, Debug)]
pub struct ScholarshipConfig {
    pub instance: Column<Instance>,
    pub constant: Column<Fixed>,
    pub poseidon: PoseidonConfig,

    pub merkle_current: Column<Advice>,
    pub merkle_sibling: Column<Advice>,
    pub merkle_direction: Column<Advice>,
    pub merkle_left: Column<Advice>,
    pub merkle_right: Column<Advice>,
    pub q_merkle_select: Selector,
}

impl ScholarshipConfig {
    pub fn configure(meta: &mut ConstraintSystem<Fp>) -> Self {
        let instance = meta.instance_column();
        let constant = meta.fixed_column();
        meta.enable_equality(instance);
        meta.enable_constant(constant);
        let poseidon = PoseidonChip::configure(meta);

        let merkle_current = meta.advice_column();
        let merkle_sibling = meta.advice_column();
        let merkle_direction = meta.advice_column();
        let merkle_left = meta.advice_column();
        let merkle_right = meta.advice_column();

        for column in [merkle_current, merkle_sibling, merkle_direction, merkle_left, merkle_right] {
            meta.enable_equality(column)
        }

        let q_merkle_select = meta.selector();

        meta.create_gate("merkle direction select", |meta| {
            let q = meta.query_selector(q_merkle_select);

            let current = meta.query_advice(merkle_current, Rotation::cur());

            let sibling = meta.query_advice(merkle_sibling, Rotation::cur());

            let direction = meta.query_advice(merkle_direction, Rotation::cur());

            let left = meta.query_advice(merkle_left, Rotation::cur());

            let right = meta.query_advice(merkle_right, Rotation::cur());

            let one = Expression::Constant(Fp::from(1));

            let direction_is_boolean = direction.clone() * (direction.clone() - one);

            let expected_left = current.clone() + direction.clone() * (sibling.clone() - current.clone());

            let expected_right = sibling.clone() + direction.clone() * (current - sibling);

            vec![q.clone() * direction_is_boolean, q.clone() * (left - expected_left), q * (right - expected_right)]
        });

        ScholarshipConfig {
            instance,
            constant,
            poseidon,
            merkle_current,
            merkle_sibling,
            merkle_direction,
            merkle_left,
            merkle_right,
            q_merkle_select,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ScholarshipCircuit {
    pub student_id: Value<Fp>,
    pub amount: Value<Fp>,
    pub rho: Value<Fp>,

    pub recipient: Value<Fp>,

    pub path_siblings: Vec<Value<Fp>>,
    pub path_directions: Vec<bool>,
}

impl Circuit<Fp> for ScholarshipCircuit {
    type Config = ScholarshipConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self {
            student_id: Value::unknown(),
            amount: Value::unknown(),
            rho: Value::unknown(),
            recipient: Value::unknown(),
            path_siblings: vec![Value::unknown(); self.path_siblings.len()],
            path_directions: vec![false; self.path_directions.len()],
        }
    }

    fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
        ScholarshipConfig::configure(meta)
    }

    fn synthesize(&self, config: Self::Config, mut layouter: impl Layouter<Fp>) -> Result<(), Error> {
        let (student_id_cell, amount_cell, rho_cell, recipient_cell) = layouter.assign_region(
            || "load inputs",
            |mut region| {
                let student_id =
                    region.assign_advice(|| "student_id", config.poseidon.state[0], 0, || self.student_id)?;

                let amount = region.assign_advice(|| "amount", config.poseidon.state[1], 0, || self.amount)?;

                let rho = region.assign_advice(|| "rho", config.poseidon.state[2], 0, || self.rho)?;

                let recipient = region.assign_advice(|| "recipient", config.merkle_current, 0, || self.recipient)?;

                Ok((student_id, amount, rho, recipient))
            },
        )?;

        let chip = Pow5Chip::<Fp, 3, 2>::construct(config.poseidon.pow5_config.clone());

        let hasher = Hash::<Fp, Pow5Chip<Fp, 3, 2>, P128Pow5T3, ConstantLength<1>, 3, 2>::init(
            chip,
            layouter.namespace(|| "nf init"),
        )?;

        let nf_cell = hasher.hash(layouter.namespace(|| "nf hash"), [rho_cell.clone()])?;

        eprintln!("nullifier in circuit = {:?}", nf_cell.value());

        let chip = Pow5Chip::<Fp, 3, 2>::construct(config.poseidon.pow5_config.clone());

        let hasher = Hash::<Fp, Pow5Chip<Fp, 3, 2>, P128Pow5T3, ConstantLength<3>, 3, 2>::init(
            chip,
            layouter.namespace(|| "poseidon init"),
        )?;

        let leaf =
            hasher.hash(layouter.namespace(|| "poseidon hash"), [student_id_cell, amount_cell.clone(), rho_cell])?;

        eprintln!("leaf in circuit = {:?}", leaf.value());

        let mut current = leaf;

        for (i, (sibling_val, direction)) in self.path_siblings.iter().zip(self.path_directions.iter()).enumerate() {
            let direction_fp = Fp::from((*direction) as u64);

            let (left, right) = layouter.assign_region(
                || format!("select merkle left right {}", i),
                |mut region| {
                    config.q_merkle_select.enable(&mut region, 0)?;

                    let current_copy = current.copy_advice(|| "copy current", &mut region, config.merkle_current, 0)?;

                    let sibling =
                        region.assign_advice(|| "merkle sibling", config.merkle_sibling, 0, || *sibling_val)?;

                    let _direction_cell = region.assign_advice(
                        || "merkle direction",
                        config.merkle_direction,
                        0,
                        || Value::known(direction_fp),
                    )?;

                    let left_value = current_copy.value().zip(sibling.value()).map(|(current_value, sibling_value)| {
                        *current_value + direction_fp * (*sibling_value - *current_value)
                    });

                    let right_value =
                        current_copy.value().zip(sibling.value()).map(|(current_value, sibling_value)| {
                            *sibling_value + direction_fp * (*current_value - *sibling_value)
                        });

                    let left = region.assign_advice(|| "selected left", config.merkle_left, 0, || left_value)?;

                    let right = region.assign_advice(|| "selected right", config.merkle_right, 0, || right_value)?;

                    Ok((left, right))
                },
            )?;

            let chip = Pow5Chip::<Fp, 3, 2>::construct(config.poseidon.pow5_config.clone());

            let hasher = Hash::<Fp, Pow5Chip<Fp, 3, 2>, P128Pow5T3, ConstantLength<2>, 3, 2>::init(
                chip,
                layouter.namespace(|| format!("merkle init {}", i)),
            )?;

            current = hasher.hash(layouter.namespace(|| format!("merkle hash {}", i)), [left, right])?;
        }

        eprintln!("computed root = {:?}", current.value());

        layouter.constrain_instance(current.cell(), config.instance, 0)?;

        layouter.constrain_instance(nf_cell.cell(), config.instance, 1)?;

        layouter.constrain_instance(amount_cell.cell(), config.instance, 2)?;

        layouter.constrain_instance(recipient_cell.cell(), config.instance, 3)?;

        Ok(())
    }
}
