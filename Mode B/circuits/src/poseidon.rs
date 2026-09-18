// use halo2_base::{
//     poseidon::hasher::PoseidonHasher,
//     poseidon::hasher::spec::OptimizedPoseidonSpec,
//     halo2_proofs::halo2curves::bn256::Fr,
//     Context,
//     gates::GateInstructions,
//     AssignedValue,
// };

// pub fn poseidon_in_circuit(
//     ctx: &mut Context<Fr>,
//     gate: &impl GateInstructions<Fr>,
//     inputs: [AssignedValue<Fr>; 3],
// ) -> AssignedValue<Fr> {

//     // ✅ tạo spec đúng cách
//     let spec = OptimizedPoseidonSpec::<Fr, 4, 3>::new::<8, 57, 0>();

//     let hasher = PoseidonHasher::<Fr, 4, 3>::new(spec);

//     hasher.hash_fix_len_array(ctx, gate, &inputs)
// }



// #[cfg(test)]
// mod tests {
//     use super::*;
//     use halo2_base::halo2_proofs::halo2curves::bn256::Fr;

//     #[test]
//     fn test_poseidon() {
//         // ❌ cái này CHƯA chạy circuit thật
//         // vì cần Context + Gate + AssignedValue
//         // eprintln!("poseidon circuit module compiled OK");
//     }
// }











// use halo2_base::{
//     AssignedValue,
//     Context,

//     gates::GateInstructions,

//     halo2_proofs::halo2curves::bn256::Fr,

//     poseidon::{
//         hasher::PoseidonHasher,
//         hasher::spec::OptimizedPoseidonSpec,
//     },
// };

// pub fn poseidon_hash(
//     ctx: &mut Context<Fr>,
//     gate: &impl GateInstructions<Fr>,
//     inputs: [AssignedValue<Fr>; 3],
// ) -> AssignedValue<Fr> {

//     let spec =
//         OptimizedPoseidonSpec::<Fr, 4, 3>::new::<8, 57, 0>();

//     let hasher =
//         PoseidonHasher::<Fr, 4, 3>::new(spec);

//     hasher.hash_fix_len_array(
//         ctx,
//         gate,
//         &inputs,
//     )
// }










// use halo2_proofs::{
//     circuit::{
//         Layouter,
//         SimpleFloorPlanner,
//         Value,
//     },

//     pasta::Fp,

//     plonk::{
//         Advice,
//         Circuit,
//         Column,
//         ConstraintSystem,
//         Error,
//     },
// };

// use halo2_gadgets::poseidon::{
//     primitives::{
//         ConstantLength,
//         P128Pow5T3,
//     },

//     Hash,
//     Pow5Chip,
//     Pow5Config,
// };

// #[derive(Clone, Debug)]
// pub struct PoseidonConfig {
//     pub state: [Column<Advice>; 3],
// }

// #[derive(Clone)]
// pub struct PoseidonCircuit {
//     pub message: [Value<Fp>; 2],
// }

// impl Circuit<Fp> for PoseidonCircuit {

//     type Config = PoseidonConfig;

//     type FloorPlanner = SimpleFloorPlanner;

//     fn without_witnesses(&self) -> Self {

//         Self {
//             message: [
//                 Value::unknown(),
//                 Value::unknown(),
//             ],
//         }
//     }

//     fn configure(
//         meta: &mut ConstraintSystem<Fp>,
//     ) -> Self::Config {

//         let state = [
//             meta.advice_column(),
//             meta.advice_column(),
//             meta.advice_column(),
//         ];

//         let rc_a = meta.fixed_column();
//         let rc_b = meta.fixed_column();

//         meta.enable_constant(rc_b);

//         let config =
//             Pow5Chip::configure::<P128Pow5T3>(
//                 meta,
//                 state,
//                 rc_a,
//                 rc_b,
//             );

//         PoseidonConfig {
//             state: config.state,
//         }
//     }

//     fn synthesize(
//         &self,
//         config: Self::Config,
//         mut layouter: impl Layouter<Fp>,
//     ) -> Result<(), Error> {

//         let chip =
//             Pow5Chip::construct(config.clone());

//         let hasher = Hash::<
//             _,
//             _,
//             P128Pow5T3,
//             ConstantLength<2>,
//             3,
//             2,
//         >::init(
//             chip,
//             layouter.namespace(|| "poseidon"),
//         )?;

//         let output =
//             hasher.hash(
//                 layouter.namespace(|| "hash"),
//                 self.message,
//             )?;

//         eprintln!("REAL Poseidon hash: {:?}", output);

//         Ok(())
//     }
// }





// use halo2_proofs::{
//     circuit::{
//         AssignedCell,
//         Layouter,
//         Region,
//         SimpleFloorPlanner,
//         Value,
//     },

//     // pasta::Fp,

//     plonk::{
//         Advice,
//         Circuit,
//         Column,
//         ConstraintSystem,
//         Error,
//         Fixed,
//         Instance
//     },
// };

// use halo2curves::bn256::Fr;

// use halo2_gadgets::poseidon::{
//     primitives::{
//         ConstantLength,
//         P128Pow5T3,
//         Hash as NativeHash
//     },

//     Hash as CircuitHash,
//     Pow5Chip,
//     Pow5Config,
// };

// #[derive(Clone, Debug)]
// pub struct PoseidonConfig {

//     pub poseidon:
//         Pow5Config<Fp, 3, 2>,
    
//     pub state: [Column<Advice>; 3],
//     pub instance:  Column<Instance>,
// }

// #[derive(Clone)]
// pub struct PoseidonCircuit {

//     pub message:
//         [Value<Fp>; 2],
// }

// impl Circuit<Fr> for PoseidonCircuit {

//     type Config = PoseidonConfig;

//     type FloorPlanner =
//         SimpleFloorPlanner;

//     fn without_witnesses(&self) -> Self {

//         Self {

//             message: [
//                 Value::unknown(),
//                 Value::unknown(),
//             ],
//         }
//     }

//     fn configure(
//         meta: &mut ConstraintSystem<Fp>,
//     ) -> Self::Config {

//         let state = [
//             meta.advice_column(),
//             meta.advice_column(),
//             meta.advice_column(),
//         ];

//         let partial_sbox =
//             meta.advice_column();

//         let rc_a = [
//             meta.fixed_column(),
//             meta.fixed_column(),
//             meta.fixed_column(),
//         ];

//         let rc_b = [
//             meta.fixed_column(),
//             meta.fixed_column(),
//             meta.fixed_column(),
//         ];

//         for column in state {
//             meta.enable_equality(column);
//         }

//         meta.enable_constant(rc_b[0]);

//         let instance =
//             meta.instance_column();

//         meta.enable_equality(instance);

//         let poseidon =
//             Pow5Chip::configure::<P128Pow5T3>(
//                 meta,
//                 state,
//                 partial_sbox,
//                 rc_a,
//                 rc_b,
//             );

//         PoseidonConfig {
//             poseidon,
//             state,
//             instance,
//         }
//     }

//     fn synthesize(
//         &self,
//         config: Self::Config,
//         mut layouter: impl Layouter<Fp>,
//     ) -> Result<(), Error> {

//         let chip =
//             Pow5Chip::construct(
//                 config.poseidon,
//             );

//         // assign witnesses thật
//         let assigned_message:
//             [AssignedCell<Fr, Fr>; 2]
//             =
//             layouter.assign_region(
//                 || "load message",

//                 |mut region: Region<'_, Fp>| {

//                     let a =
//                         region.assign_advice(
//                             || "a",
//                             config.state[0],
//                             0,
//                             || self.message[0],
//                         )?;

//                     let b =
//                         region.assign_advice(
//                             || "b",
//                             config.state[1],
//                             0,
//                             || self.message[1],
//                         )?;

//                     Ok([a, b])
//                 },
//             )?;

//         let hasher =
//             CircuitHash::<
//                 _,
//                 _,
//                 P128Pow5T3,
//                 ConstantLength<2>,
//                 3,
//                 2,
//             >::init(
//                 chip,
//                 layouter.namespace(
//                     || "poseidon",
//                 ),
//             )?;

//         let output =
//             hasher.hash(
//                 layouter.namespace(
//                     || "hash",
//                 ),

//                 assigned_message,
//             )?;

//         eprintln!(
//             "REAL Poseidon hash = {:?}",
//             output.value(),
//         );

//         layouter.constrain_instance(
//             output.cell(),
//             config.instance,
//             0,
//         )?;

//         Ok(())
//     }
// }



// pub fn native_poseidon(
//     a: Fr,
//     b: Fr,
// ) -> Fr {

//     NativeHash::<
//         _,
//         P128Pow5T3,
//         ConstantLength<2>,
//         3,
//         2,
//     >::init()
//     .hash([a, b])
// }
















// use halo2_base::{
//     Context,
//     gates::GateInstructions,
//     poseidon::hasher::{PoseidonHasher, spec::OptimizedPoseidonSpec},
//     AssignedValue,
//     halo2_proofs::halo2curves::bn256::Fr
// };

// pub struct PoseidonChip;

// impl PoseidonChip {

//     // =========================
//     // INIT HASHER
//     // =========================
//     pub fn new_hasher() -> PoseidonHasher<Fr, 3, 2> {
//         // let spec = OptimizedPoseidonSpec::new();
//         let spec = OptimizedPoseidonSpec::<Fr, 3, 2>::new::<8, 57, 0>(); 
//         PoseidonHasher::<Fr, 3, 2>::new(spec)
//     }

//     // =========================
//     // HASH NOTE → COMMITMENT
//     // =========================
//     pub fn hash_note(
//         ctx: &mut Context<Fr>,
//         gate: &impl GateInstructions<Fr>,
//         hasher: &mut PoseidonHasher<Fr, 3, 2>,
//         note: &[AssignedValue<Fr>],
//     ) -> AssignedValue<Fr> {

//         hasher.initialize_consts(ctx, gate);

//         let hash = hasher.hash_fix_len_array(
//             ctx,
//             gate,
//             note,
//         );

//         hash
//     }

//     // =========================
//     // MERKLE NODE HASH
//     // =========================
//     pub fn hash_pair(
//         ctx: &mut Context<Fr>,
//         gate: &impl GateInstructions<Fr>,
//         hasher: &mut PoseidonHasher<Fr, 3, 2>,
//         left: AssignedValue<Fr>,
//         right: AssignedValue<Fr>,
//     ) -> AssignedValue<Fr> {

//         hasher.initialize_consts(ctx, gate);

//         let inputs = vec![left, right];

//         hasher.hash_fix_len_array(
//             ctx,
//             gate,
//             &inputs,
//         )
//     }

//     // =========================
//     // NULLIFIER HASH (rho)
//     // =========================
//     pub fn hash_nullifier(
//         ctx: &mut Context<Fr>,
//         gate: &impl GateInstructions<Fr>,
//         hasher: &mut PoseidonHasher<Fr, 3, 2>,
//         rho: AssignedValue<Fr>,
//     ) -> AssignedValue<Fr> {

//         hasher.initialize_consts(ctx, gate);

//         hasher.hash_fix_len_array(
//             ctx,
//             gate,
//             &vec![rho],
//         )
//     }
// }







use halo2_base::{
    Context,
    gates::{flex_gate::GateChip, circuit::builder::BaseCircuitBuilder},
    poseidon::hasher::{PoseidonHasher, spec::OptimizedPoseidonSpec},
    AssignedValue,
    halo2_proofs::halo2curves::bn256::Fr

};
use snark_verifier::loader::halo2::IntegerInstructions;
use halo2curves::ff::PrimeField;
use halo2_base::gates::GateInstructions;
use crate::commitment::CommitmentChip;
use crate::note::Note;

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


// #[cfg(test)]
// mod tests {
//     use super::*;
//     use halo2_base::gates::circuit::builder::BaseCircuitBuilder;

//     #[test]
//     fn test_poseidon_chip() {

//         let mut builder = BaseCircuitBuilder::<Fr>::new(false);
//         let ctx = builder.main(0);

//         let gate = builder.core().gate();

//         let mut hasher = PoseidonChip::new_hasher();

//         let a = ctx.load_witness(Fr::from(10));
//         let b = ctx.load_witness(Fr::from(20));
//         let c = ctx.load_witness(Fr::from(30));

//         let note = vec![a, b, c];

//         let commitment = PoseidonChip::hash_note(
//             ctx,
//             // builder.core(),
//             builder.main(0),
//             &mut hasher,
//             &note,
//         );

//         let nullifier = PoseidonChip::hash_nullifier(
//             ctx,
//             builder.core(),
//             &mut hasher,
//             c,
//         );


//         builder.assigned_instances
//             .push(vec![commitment]);

//         eprintln!("commitment exposed as public input");

//         eprintln!("commitment + nullifier generated");

//         assert!(true);
//     }
// }









#[test]
fn test_poseidon_chip() {

    let mut builder = BaseCircuitBuilder::<Fr>::new(false);
    let mut ctx = builder.main(0);

    // let gate = builder.range_chip(); // ✔ ĐÚNG
    // let gate = GateChip::new();
    let gate = GateChip::<Fr>::new();

    let mut hasher = PoseidonChip::new_hasher();

    // =========================
    // LOAD WITNESS
    // =========================

    
    let a = ctx.load_witness(Fr::from(10));
    let b = ctx.load_witness(Fr::from(20));
    let c = ctx.load_witness(Fr::from(30));

    // =========================
    // OFF-CIRCUIT HASH
    // =========================

    // let hash_note = NativePoseidon::hash_note(10, 20, 30);

    // let note = vec![a, b, c];
    let note = Note {
        student_id: a,
        amount: b,
        rho: c,
    };


    // =========================
    // IN-CIRCUIT HASH
    // =========================

    // let commitment = PoseidonChip::hash_note(
    //     &mut ctx,
    //     &gate,
    //     &mut hasher,
    //     &note,
    // );


    let note_input = note.to_vec();


    let failure_note = Note {
        student_id: a,
        amount: ctx.load_witness(Fr::from(999)), // ❌ amount khác
        rho: c,
    };

    let failure_note_input = failure_note.to_vec();

    let commitment = PoseidonChip::hash_note(
        &mut ctx,
        &gate,
        &mut hasher,
        &note_input,
    );

    // let nullifier = PoseidonChip::hash_nullifier(
    //     &mut ctx,
    //     &gate,
    //     &mut hasher,
    //     c,
    // );

    let public_commitment = CommitmentChip::create_commitment(
        &mut ctx,
        &gate,
        &mut hasher,
        &failure_note,
    );

    // let pb_cm = ctx.load_witness(public_commitment.value());

    // let public_commitment =
    //     ctx.load_witness(
    //         Fr::from_str_vartime(
    //             &format!("{}", hash_note)
    //         ).unwrap()
    //     );

    // let public_commitment = ctx.load_witness(hash_note);



    // =========================
    // CONSTRAINT
    // commitment == public_input
    // =========================

    // gate.assert_equal(
    //     &mut ctx,
    //     commitment,
    //     public_commitment,
    // );

    let is_equal =
        gate.is_equal(
            &mut ctx,
            commitment,
            public_commitment,
        );

    gate.assert_is_const(
        &mut ctx,
        &is_equal,
        &Fr::one(),
    );
    // builder.assigned_instances.push(vec![commitment]);
    eprintln!(
        "constraint added:
         circuit_hash == public_hash"
    );


    // gate.assert_equal(
    //     &mut ctx,
    //     &commitment,
    //     &public_commitment,
    // );
}