use halo2_base::{
    gates::{
        circuit::{builder::BaseCircuitBuilder, BaseConfig},
        flex_gate::GateChip,
        GateInstructions,
    },
    halo2_proofs::{
        circuit::{Layouter, SimpleFloorPlanner},
        halo2curves::bn256::Fr,
        plonk::{Circuit, ConstraintSystem, Error},
    },
};

use crate::{
    commitment::CommitmentChip,
    merkle_tree::{MerkleProof, MerkleTreeChip, MerkleWitness},
    note::{AssignedNote, Note},
    poseidon::PoseidonChip,
};

pub const DEFAULT_K: usize = 13;

pub fn k() -> usize {
    match std::env::var("HALO2_K") {
        Err(_) => DEFAULT_K,

        Ok(value) => {
            let parsed: usize = value.trim().parse().unwrap_or_else(|_| panic!("HALO2_K is not a number: {:?}", value));

            if !(4..=20).contains(&parsed) {
                panic!("HALO2_K must be in 4..=20: {}", parsed);
            }

            parsed
        }
    }
}

#[derive(Clone, Debug)]
pub struct ScholarshipCircuit {
    pub note: Note,
    pub witness: MerkleWitness,
    pub expected_root: Fr,
    pub expected_nullifier: Fr,
    pub recipient: Fr,
}

impl ScholarshipCircuit {
    pub fn new(note: Note, witness: MerkleWitness, expected_root: Fr, expected_nullifier: Fr, recipient: Fr) -> Self {
        Self { note, witness, expected_root, expected_nullifier, recipient }
    }

    pub fn build_constraints(&self, builder: &mut BaseCircuitBuilder<Fr>) {
        let mut ctx = builder.main(0);
        let gate = GateChip::<Fr>::new();
        let mut hasher = PoseidonChip::new_hasher();

        let note = AssignedNote {
            student_id: ctx.load_witness(self.note.student_id),
            amount: ctx.load_witness(self.note.amount),
            rho: ctx.load_witness(self.note.rho),
        };

        let public_amount = note.amount;

        let commitment = CommitmentChip::create_commitment(&mut ctx, &gate, &mut hasher, &note);

        let nullifier = CommitmentChip::create_nullifier(&mut ctx, &gate, &mut hasher, note.rho);

        let expected_nullifier = ctx.load_witness(self.expected_nullifier);
        let is_equal = gate.is_equal(&mut ctx, nullifier, expected_nullifier);

        gate.assert_is_const(&mut ctx, &is_equal, &Fr::one());

        let proof = MerkleProof::from_witness(&mut ctx, &self.witness);

        let expected_root = ctx.load_witness(self.expected_root);

        MerkleTreeChip::verify_membership(&mut ctx, &gate, &mut hasher, commitment, &proof, expected_root);

        let recipient = ctx.load_witness(self.recipient);

        builder.assigned_instances[0].push(expected_root);
        builder.assigned_instances[1].push(expected_nullifier);
        builder.assigned_instances[2].push(public_amount);
        builder.assigned_instances[3].push(recipient);

        eprintln!("instances col0 - root = {:?}", builder.assigned_instances[0]);

        eprintln!("instances col1 - nullifier = {:?}", builder.assigned_instances[1]);

        eprintln!("instances col2 - amount = {:?}", builder.assigned_instances[2]);

        eprintln!("In-circuit values:");

        eprintln!("Public root = {:?}", expected_root.value());

        eprintln!("Computed nullifier = {:?}", nullifier.value());

        eprintln!("Public amount = {:?}", public_amount.value());
    }

    pub fn create_builder(&self) -> BaseCircuitBuilder<Fr> {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false).use_k(k()).use_instance_columns(4);

        self.build_constraints(&mut builder);
        builder.calculate_params(None);
        builder
    }
}

impl Circuit<Fr> for ScholarshipCircuit {
    type Config = BaseConfig<Fr>;
    type FloorPlanner = SimpleFloorPlanner;
    type Params = ();

    fn without_witnesses(&self) -> Self {
        Self {
            note: Note { student_id: Fr::zero(), amount: Fr::zero(), rho: Fr::zero() },
            witness: MerkleWitness { leaf: Fr::zero(), siblings: vec![], directions: vec![], root: Fr::zero() },
            expected_root: Fr::zero(),
            expected_nullifier: Fr::zero(),
            recipient: Fr::zero(),
        }
    }

    fn configure(meta: &mut ConstraintSystem<Fr>) -> Self::Config {
        BaseCircuitBuilder::<Fr>::configure(meta)
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        let builder = self.create_builder();
        builder.synthesize(config, layouter)
    }
}
