// use halo2_base::{
//     gates::{
//         circuit::builder::BaseCircuitBuilder,
//         flex_gate::GateChip,
//     },

//     AssignedValue,

//     halo2_proofs::{
//         dev::MockProver,
//         halo2curves::bn256::Fr,
//         plonk::{
//             Circuit,
//             ConstraintSystem,
//             Error,
//         },
//         circuit::{SimpleFloorPlanner, Layouter},
//     },

    
// };

// use crate::{
//     note::Note,
//     poseidon::PoseidonChip,
//     commitment::CommitmentChip,
//     merkle_tree::{MerkleTree, MerkleProof, MerkleTreeChip, MerkleWitness},
// };

// use snark_verifier_sdk::CircuitExt;

// use halo2_base::gates::GateInstructions;
// use halo2_base::halo2_proofs::poly::kzg::commitment::ParamsKZG;
// use halo2_base::halo2_proofs::halo2curves::bn256::Bn256;
// use halo2curves::ff::Field;

// #[derive(Clone, Debug)]
// pub struct NoteNative {

//     pub student_id: Fr,

//     pub amount: Fr,

//     pub rho: Fr,
// }

// #[derive(Clone, Debug)]
// pub struct ScholarshipCircuit {

//     pub note: NoteNative,

//     pub witness: MerkleWitness,

//     pub root: Fr,

//     pub nullifier: Fr,
// }

// // #[derive(Clone, Debug)]
// // pub struct ScholarshipHalo2Circuit {

// //     pub inner:
// //         ScholarshipCircuit,
// // }

// #[derive(Clone, Debug)]
// pub struct ScholarshipConfig;


// impl ScholarshipCircuit {

//     pub fn new(
//         note: NoteNative,
//         witness: MerkleWitness,
//         root: Fr,
//         nullifier: Fr,
//     ) -> Self {

//         Self {
//             note,
//             witness,
//             root,
//             nullifier,
//         }
//     }



//     pub fn build_constraints(
//         &self,
//         builder: &mut BaseCircuitBuilder<Fr>,
//     ) {

//         let mut ctx =
//             builder.main(0);

//         let gate =
//             GateChip::<Fr>::new();

//         let mut hasher =
//             PoseidonChip::new_hasher();

//         // assign note

//         let note = Note {

//             student_id:
//                 ctx.load_witness(
//                     self.note.student_id
//                 ),

//             amount:
//                 ctx.load_witness(
//                     self.note.amount
//                 ),

//             rho:
//                 ctx.load_witness(
//                     self.note.rho
//                 ),
//         };

//         let commitment =
//             CommitmentChip::create_commitment(
//                 &mut ctx,
//                 &gate,
//                 &mut hasher,
//                 &note,
//             );

//         let nullifier =
//             CommitmentChip::create_nullifier(
//                 &mut ctx,
//                 &gate,
//                 &mut hasher,
//                 note.rho,
//             );

//         let proof =
//             MerkleProof::from_witness(
//                 &mut ctx,
//                 &self.witness,
//             );

//         let expected_root =
//             ctx.load_witness(
//                 self.root
//             );

//         MerkleTreeChip::verify_membership(
//             &mut ctx,
//             &gate,
//             &mut hasher,
//             commitment,
//             &proof,
//             expected_root,
//         );

//         builder.assigned_instances[0]
//             .push(expected_root);

//         builder.assigned_instances[1]
//             .push(nullifier);
        
//         eprintln!("instances col0 = {:?}", builder.assigned_instances[0]);
//         eprintln!("instances col1 = {:?}", builder.assigned_instances[1]);
//     }

//     pub fn native_commitment(
//         note: &NoteNative,
//     ) -> Fr {

//         let mut builder =
//             BaseCircuitBuilder::<Fr>::new(false);

//         let mut ctx =
//             builder.main(0);

//         let gate =
//             GateChip::<Fr>::new();

//         let mut hasher =
//             PoseidonChip::new_hasher();

//         let note_assigned =
//             Note {

//                 student_id:
//                     ctx.load_witness(
//                         note.student_id
//                     ),

//                 amount:
//                     ctx.load_witness(
//                         note.amount
//                     ),

//                 rho:
//                     ctx.load_witness(
//                         note.rho
//                     ),
//             };

//         let commitment =
//             CommitmentChip::create_commitment(
//                 &mut ctx,
//                 &gate,
//                 &mut hasher,
//                 &note_assigned,
//             );

//         *commitment.value()
//     }

//     pub fn native_nullifier(
//         rho: Fr,
//     ) -> Fr {

//         let mut builder =
//             BaseCircuitBuilder::<Fr>::new(false);

//         let mut ctx =
//             builder.main(0);

//         let gate =
//             GateChip::<Fr>::new();

//         let mut hasher =
//             PoseidonChip::new_hasher();

//         let rho_assigned =
//             ctx.load_witness(rho);

//         let nullifier =
//             CommitmentChip::create_nullifier(
//                 &mut ctx,
//                 &gate,
//                 &mut hasher,
//                 rho_assigned,
//             );

//         *nullifier.value()
//     }



//      pub fn create_builder(
//         &self,
//     ) -> BaseCircuitBuilder<Fr> {

//         let mut builder =
//             BaseCircuitBuilder::<Fr>::new(false)
//                 .use_k(12)
//                 .use_instance_columns(2);

//         self.build_constraints(
//             &mut builder
//         );

//         builder.calculate_params(None);
//         // builder.finalize();
//         builder
//     }


//     pub fn to_circuit_ext(&self) -> impl CircuitExt<Fr> {
//         let builder = self.create_builder();
//         builder
//     }
 
// }




// impl Circuit<Fr> for ScholarshipCircuit {
//     type Config = ScholarshipConfig;

//     type FloorPlanner = SimpleFloorPlanner;

//     type Params = ();

//     fn without_witnesses(&self) -> Self {
//         Self {
//             note: NoteNative {
//                 student_id: Fr::zero(),
//                 amount: Fr::zero(),
//                 rho: Fr::zero(),
//             },
//             witness: MerkleWitness {
//                 leaf: Fr::zero(),
//                 siblings: vec![],
//                 directions: vec![],
//                 root: Fr::zero(),
//             },
//             root: Fr::zero(),
//             nullifier: Fr::zero(),
//         }
//     }

//     fn configure(
//         _meta: &mut ConstraintSystem<Fr>,
//     ) -> Self::Config {
//         // ScholarshipConfig
//         BaseCircuitBuilder::<Fr>::configure(meta, vec![12], &[], &[], 2)
//     }

//     fn synthesize(
//         &self,
//         _config: Self::Config,
//         _layouter: impl Layouter<Fr>,
//     ) -> Result<(), Error> {

//         // let mut builder =
//         //     BaseCircuitBuilder::<Fr>::new(false)
//         //         .use_k(12)
//         //         .use_instance_columns(2);

//         // self.build_constraints(
//         //     &mut builder
//         // );
//         let mut builder = self.create_builder();
//         builder.synthesize(_config, _layouter);
//         // builder.calculate_params(None);

//         Ok(())
//     }
// }


// // impl Circuit<Fr>
// //     for ScholarshipHalo2Circuit
// // {
// //     type Config =
// //         ScholarshipConfig;

// //     type FloorPlanner =
// //         SimpleFloorPlanner;

// //     fn without_witnesses(
// //         &self,
// //     ) -> Self {

// //         Self {

// //             inner:
// //                 ScholarshipCircuit {

// //                     note:
// //                         NoteNative {

// //                             student_id:
// //                                 Fr::ZERO,

// //                             amount:
// //                                 Fr::ZERO,

// //                             rho:
// //                                 Fr::ZERO,
// //                         },

// //                     witness:
// //                         MerkleWitness {

// //                             siblings:
// //                                 vec![],

// //                             directions:
// //                                 vec![],
// //                         },

// //                     root:
// //                         Fr::ZERO,

// //                     nullifier:
// //                         Fr::ZERO,
// //                 },
// //         }
// //     }

// //     fn configure(
// //         _meta:
// //             &mut ConstraintSystem<Fr>,
// //     ) -> Self::Config {

// //         ScholarshipConfig
// //     }

// //     fn synthesize(
// //         &self,

// //         _config:
// //             Self::Config,

// //         _layouter:
// //             impl halo2_base::halo2_proofs::circuit::Layouter<Fr>,
// //     ) -> Result<(), Error> {

// //         Ok(())
// //     }
// // }

// // #[test]
// // fn test_real_constraint_pass() {

// //     // =========================
// //     // CREATE BUILDER
// //     // =========================

// //     let mut builder =
// //         BaseCircuitBuilder::<Fr>::new(false).use_k(12).use_instance_columns(1);
    


    
// //     // let params = builder.calculate_params(None);
// //     // builder.set_params(params);
// //     // builder.assigned_instances = vec![vec![]]; 
// //     // builder.set_instance_columns(1);
// //     // let k = 12;

// //     // builder.set_k(12);
// //     // builder.set_instance_columns(1);
// //     // builder.set_k(k as usize);

// //     let mut ctx =
// //         builder.main(0);
    
// //     // builder.assigned_instances[0].push(public_commitment);
// //     // builder.calculate_params(None);
// //     let gate =
// //         GateChip::<Fr>::new();

// //     let mut hasher =
// //         PoseidonChip::new_hasher();

// //     // =========================
// //     // REAL NOTE
// //     // =========================

// //     // let student_id =
// //     //     ctx.load_witness(Fr::from(1));

// //     // let amount =
// //     //     ctx.load_witness(Fr::from(100));

// //     // let rho =
// //     //     ctx.load_witness(Fr::from(999));

// //     // let note = Note {
// //     //     student_id,
// //     //     amount,
// //     //     rho,
// //     // };

  

// //     // =========================
// //     // FAILURE NOTE
// //     // amount changed
// //     // =========================

// //     // let bad_amount =
// //     //     ctx.load_witness(Fr::from(777));

// //     // let bad_note = Note {
// //     //     student_id,
// //     //     amount: bad_amount,
// //     //     rho,
// //     // };

// //     // =========================
// //     // HASH 1
// //     // =========================

// //     // let commitment =
// //     //     CommitmentChip::create_commitment(
// //     //         &mut ctx,
// //     //         &gate,
// //     //         &mut hasher,
// //     //         &note,
// //     //     );

// //     // let commitment =
// //     //     gate.add(&mut ctx, student_id, amount);

// //     // =========================
// //     // HASH 2
// //     // =========================

// //     // let public_commitment =
// //     //     CommitmentChip::create_commitment(
// //     //         &mut ctx,
// //     //         &gate,
// //     //         &mut hasher,
// //     //         &note,
// //     //     );

// //     // let public_commitment =
// //     //     gate.add(&mut ctx, student_id, amount);

// //     // =========================
// //     // CONSTRAINT
// //     // =========================

// //     let note1 = crate::note::Note {
// //         student_id: ctx.load_witness(Fr::from(24560002)),
// //         amount: ctx.load_witness(Fr::from(2)),
// //         rho: ctx.load_witness(Fr::from(1234567))
// //     };

// //     let note2 = crate::note::Note {
// //         student_id: ctx.load_witness(Fr::from(24560003)),
// //         amount: ctx.load_witness(Fr::from(3)),
// //         rho: ctx.load_witness(Fr::from(1234568))
// //     };

// //     let commitment1 = crate::commitment::CommitmentChip::create_commitment(
// //         &mut ctx,
// //         &gate,
// //         &mut hasher,
// //         &note1,
// //     );

// //     let commitment2 = crate::commitment::CommitmentChip::create_commitment(
// //         &mut ctx,
// //         &gate,
// //         &mut hasher,
// //         &note2,
// //     );

// //     let nullifier1  = crate::commitment::CommitmentChip::create_nullifier(
// //         &mut ctx,
// //         &gate,
// //         &mut hasher,
// //         note1.rho,
// //     );

// //     let mut tree =
// //         MerkleTree::new(3);

// //     // depth = 2
// //     // total leaves = 4

// //     tree.insert(
// //         // Fr::from(10)
// //         *commitment1.value()
// //     );

// //     tree.insert(
// //         *commitment2.value()
// //     );

// //     let root = tree.root();
// //     eprintln!("root: {:?}", root);

// //     let (
// //         siblings,
// //         directions,
// //     ) = tree.get_path(0);

// //     eprintln!(
// //         "siblings len = {}",
// //         siblings.len(),
// //     );

// //     eprintln!("siblings = [");
// //     for s in &siblings {
// //         eprintln!("  {:?}", s);
// //     }
// //     eprintln!("]");

// //     eprintln!(
// //         "directions = {:?}",
// //         directions,
// //     );





// //     // let is_equal =
// //     //     gate.is_equal(
// //     //         &mut ctx,
// //     //         commitment,
// //     //         public_commitment,
// //     //     );

// //     // gate.assert_is_const(
// //     //     &mut ctx,
// //     //     &is_equal,
// //     //     &Fr::one(),
// //     // );
// //     // eprintln!("constraint added");

// //     let assigned_siblings:
// //         Vec<AssignedValue<Fr>>
// //         =
// //         siblings
// //             .iter()
// //             .map(|x| {
// //                 ctx.load_witness(*x)
// //             })
// //             .collect();

// //     let merkle_path =
// //         MerkleProof {

// //             siblings:
// //                 assigned_siblings,

// //             directions,
// //         };


// //     // let wrong_root =
// //     //     root + Fr::from(1);

// //     let expected_root =
// //         ctx.load_witness(root); // ❌ root sai, test sẽ fail
    
// //     eprintln!("Expected root: {:?}", expected_root);

// //     // =========================
// //     // VERIFY
// //     // =========================

// //     MerkleTreeChip::verify_membership(
// //         &mut ctx,
// //         &gate,
// //         &mut hasher,
// //         commitment1,
// //         &merkle_path,
// //         expected_root,
// //     );

// //     // =========================
// //     // BUILD CIRCUIT
// //     // =========================

// //     // let circuit =
// //     //     builder.build();
// //     builder.assigned_instances[0].push(expected_root);
// //     builder.assigned_instances[0].push(nullifier1);
// //     builder.calculate_params(None);
// //     // builder.assigned_instances = vec![vec![]];
// //     // builder.assigned_instances[0]
// //     //     .push(public_commitment);
    
// //     // builder.assigned_instances[0].push(public_commitment);
// //     // builder.assign_instances(0, 0, *public_commitment.value());
// //     // let circuit = builder.clone();

    
// //     // builder.set_instance_columns(1); // đảm bảo init


// //     // builder.assign_instances(&[], builder.clone().prover());
// //     // builder.assigned_instances[0].push(public_commitment);
// //     // builder.assigned_instances.push([public_commitment]);
// //     let prover =
// //         MockProver::run(
// //             12,
// //             &builder,
// //             vec![vec![*expected_root.value(), *nullifier1.value()]],
// //         ).unwrap();


// //     // let commitment_val = *commitment.value();
// //     // let public_val = *public_commitment.value();

// //     // eprintln!("commitment = {:?}", commitment_val);
// //     // eprintln!("public     = {:?}", public_val);

// //     // if commitment_val == public_val {
// //     //     eprintln!("✅ PASS: commitment == public_commitment");
// //     // } else {
// //     //     eprintln!("❌ FAIL: mismatch");
// //     // }

    

// //     // =========================
// //     // MOCK PROVER
// //     // =========================

// //     // let prover =
// //     //     MockProver::run(
// //     //         12,
// //     //         &circuit,
// //     //         vec![],
// //     //     ).unwrap();

// //     // =========================
// //     // THIS MUST FAIL
// //     // =========================



    

// //     prover.assert_satisfied();
// //     eprintln!("✅ CIRCUIT SATISFIED");
// // }
















use halo2_base::{
    gates::{
        circuit::{builder::BaseCircuitBuilder, BaseConfig},
        flex_gate::GateChip,
        GateInstructions,
    },
    AssignedValue,
    halo2_proofs::{
        halo2curves::bn256::Fr,
        plonk::{Circuit, ConstraintSystem, Error},
        circuit::{SimpleFloorPlanner, Layouter},
    },
};

use crate::{
    note::Note,
    poseidon::PoseidonChip,
    commitment::CommitmentChip,
    merkle_tree::{MerkleProof, MerkleTreeChip, MerkleWitness},
};

use snark_verifier_sdk::CircuitExt;

#[derive(Clone, Debug)]
pub struct NoteNative {
    pub student_id: Fr,
    pub amount: Fr,
    pub rho: Fr,
}

#[derive(Clone, Debug)]
pub struct ScholarshipCircuit {
    pub note: NoteNative,
    pub witness: MerkleWitness,
    pub expected_root: Fr,
    pub expected_nullifier: Fr,
    /// A25 — vi nhan tien, public input thu 4 (cot instance 3).
    pub recipient: Fr,
}

impl ScholarshipCircuit {
    pub fn new(
        note: NoteNative,
        witness: MerkleWitness,
        expected_root: Fr,
        expected_nullifier: Fr,
        recipient: Fr,
    ) -> Self {
        Self {
            note,
            witness,
            expected_root,
            expected_nullifier,
            recipient,
        }
    }

    pub fn build_constraints(
        &self,
        builder: &mut BaseCircuitBuilder<Fr>,
    ) {
        let mut ctx = builder.main(0);
        let gate = GateChip::<Fr>::new();
        let mut hasher = PoseidonChip::new_hasher();

        // Assign note
        let note = Note {
            student_id: ctx.load_witness(self.note.student_id),
            amount: ctx.load_witness(self.note.amount),
            rho: ctx.load_witness(self.note.rho),
        };

        let public_amount = note.amount;

        let commitment = CommitmentChip::create_commitment(
            &mut ctx,
            &gate,
            &mut hasher,
            &note,
        );

        let nullifier = CommitmentChip::create_nullifier(
            &mut ctx,
            &gate,
            &mut hasher,
            note.rho,
        );

        let expected_nullifier = ctx.load_witness(self.expected_nullifier);
        let is_equal = gate.is_equal(&mut ctx, nullifier, expected_nullifier);

        gate.assert_is_const(&mut ctx, &is_equal, &Fr::one());

        let proof = MerkleProof::from_witness(
            &mut ctx,
            &self.witness,
        );

        let expected_root = ctx.load_witness(self.expected_root);

        MerkleTreeChip::verify_membership(
            &mut ctx,
            &gate,
            &mut hasher,
            commitment,
            &proof,
            expected_root,
        );

        // Đẩy giá trị vào các cột public instances tương ứng với cài đặt khởi tạo (2 columns)
        /*
         * A25 — vi nhan tien. Chi nap lam witness roi day vao cot
         * instance 3: builder copy-constraint o nay bang gia tri cong
         * khai, the la du de doi vi thi proof hong.
         */
        let recipient = ctx.load_witness(self.recipient);

        builder.assigned_instances[0].push(expected_root);
        builder.assigned_instances[1].push(expected_nullifier);
        builder.assigned_instances[2].push(public_amount);
        builder.assigned_instances[3].push(recipient);
        
        // eprintln!("instances col0 = {:?}", builder.assigned_instances[0]);
        // eprintln!("instances col1 = {:?}", builder.assigned_instances[1]);

        // eprintln!("🚨 LOG TRONG MẠCH (In-Circuit):");
        // eprintln!("Root computed = {:?}", expected_root.value());
        // eprintln!("Nullifier computed = {:?}", nullifier.value());



        eprintln!(
            "instances col0 - root = {:?}",
            builder.assigned_instances[0]
        );

        eprintln!(
            "instances col1 - nullifier = {:?}",
            builder.assigned_instances[1]
        );

        eprintln!(
            "instances col2 - amount = {:?}",
            builder.assigned_instances[2]
        );

        eprintln!(
            "🚨 LOG TRONG MẠCH (In-Circuit):"
        );

        eprintln!(
            "Public root = {:?}",
            expected_root.value()
        );

        eprintln!(
            "Computed nullifier = {:?}",
            nullifier.value()
        );

        eprintln!(
            "Public amount = {:?}",
            public_amount.value()
        );
    }

    /*
     * Root mà circuit SẼ tính ra, tính sẵn ở ngoài circuit.
     *
     * Dùng đúng khuôn native_commitment / native_nullifier:
     * dựng một BaseCircuitBuilder tạm, chạy đúng chip mà
     * circuit thật dùng, rồi đọc giá trị ra. Nhờ vậy kết quả
     * khớp tuyệt đối với compute_root trong circuit, không
     * phải cài lại phép băm lần thứ hai.
     *
     * Builder tạm này KHÔNG liên quan tới circuit dùng cho
     * keygen, nên vk và Halo2Verifier.sol không đổi.
     *
     * Vì sao cần: xem code/CONSTRAINT_FLOW.md mục 7b.
     */
    pub fn native_merkle_root(
        leaf: Fr,
        witness: &MerkleWitness,
    ) -> Fr {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let mut ctx = builder.main(0);
        let gate = GateChip::<Fr>::new();
        let mut hasher = PoseidonChip::new_hasher();

        let leaf_assigned = ctx.load_witness(leaf);

        let proof = MerkleProof::from_witness(
            &mut ctx,
            witness,
        );

        let computed_root = MerkleTreeChip::compute_root(
            &mut ctx,
            &gate,
            &mut hasher,
            leaf_assigned,
            &proof,
        );

        *computed_root.value()
    }

    pub fn native_commitment(note: &NoteNative) -> Fr {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let mut ctx = builder.main(0);
        let gate = GateChip::<Fr>::new();
        let mut hasher = PoseidonChip::new_hasher();

        let note_assigned = Note {
            student_id: ctx.load_witness(note.student_id),
            amount: ctx.load_witness(note.amount),
            rho: ctx.load_witness(note.rho),
        };

        let commitment = CommitmentChip::create_commitment(
            &mut ctx,
            &gate,
            &mut hasher,
            &note_assigned,
        );

        *commitment.value()
    }

    pub fn native_nullifier(rho: Fr) -> Fr {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let mut ctx = builder.main(0);
        let gate = GateChip::<Fr>::new();
        let mut hasher = PoseidonChip::new_hasher();

        let rho_assigned = ctx.load_witness(rho);
        let nullifier = CommitmentChip::create_nullifier(
            &mut ctx,
            &gate,
            &mut hasher,
            rho_assigned,
        );

        *nullifier.value()
    }

    pub fn create_builder(&self) -> BaseCircuitBuilder<Fr> {
        // K = 13, 4 cột public instance [root, nullifier, amount, recipient].
        // K nâng 12 -> 13 khi MERKLE_DEPTH đổi 3 -> 7 (A1): thêm 4 tầng
        // Merkle = thêm 4 lần Poseidon, không còn vừa 2^12 hàng.
        // Đổi K = đổi circuit shape => phải `export-verifier` lại,
        // compile lại contract và DEPLOY LẠI pool.
        //
        // LAP20 (16/09/2026): K nay đọc từ `HALO2_K` (mặc định 13) để thí
        // nghiệm theo độ sâu tìm được K nhỏ nhất cho từng d. Không đặt biến
        // thì y hệt trước.
        let mut builder = BaseCircuitBuilder::<Fr>::new(false)
            .use_k(k_mach())
            .use_instance_columns(4);

        self.build_constraints(&mut builder);
        builder.calculate_params(None);
        builder
    }

    pub fn to_circuit_ext(&self) -> impl CircuitExt<Fr> {
        let builder = self.create_builder();
        builder
    }
}

/*
 * LAP20 (16/09/2026) — K của mạch, đọc từ biến môi trường `HALO2_K`.
 *
 * Mặc định 13, đúng giá trị đã dùng cho mọi lô đo trước đây; không đặt biến
 * thì hành vi không đổi. Thí nghiệm theo độ sâu cần K thay đổi theo d, và cây
 * nhỏ (d < 9) dùng được K nhỏ hơn.
 *
 * 🔴 Giá trị này PHẢI khớp với K dùng để sinh params KZG bên prover
 * (`experiment.rs` và `generate_proof.rs` đều gọi hàm này). Lệch nhau thì
 * keygen/create_proof hỏng hoặc proof không verify được.
 *
 * Giá trị sai thì panic, KHÔNG lặng lẽ quay về 13: im lặng nghĩa là một lô
 * "theo d" thực ra đo toàn K = 13.
 */
pub fn k_mach() -> usize {
    match std::env::var("HALO2_K") {
        Err(_) => 13,

        Ok(gia_tri) => {
            let k: usize =
                gia_tri
                    .trim()
                    .parse()
                    .unwrap_or_else(|_| {
                        panic!("HALO2_K khong hop le: {:?}", gia_tri)
                    });

            if !(4..=20).contains(&k) {
                panic!("HALO2_K ngoai khoang 4..=20: {}", k);
            }

            k
        }
    }
}

// Triển khai cấu trúc Circuit của Halo2 sử dụng BaseConfig của thư viện gốc halo2-base
impl Circuit<Fr> for ScholarshipCircuit {
    // 🔴 Thay đổi từ ScholarshipConfig sang BaseConfig<Fr>
    type Config = BaseConfig<Fr>;
    type FloorPlanner = SimpleFloorPlanner;
    type Params = ();

    fn without_witnesses(&self) -> Self {
        Self {
            note: NoteNative {
                student_id: Fr::zero(),
                amount: Fr::zero(),
                rho: Fr::zero(),
            },
            witness: MerkleWitness {
                leaf: Fr::zero(),
                siblings: vec![],
                directions: vec![],
                root: Fr::zero(),
            },
            expected_root: Fr::zero(),
            expected_nullifier: Fr::zero(),
            recipient: Fr::zero(),
        }
    }

    fn configure(
        meta: &mut ConstraintSystem<Fr>,
    ) -> Self::Config {
        // Hàm configure của BaseCircuitBuilder chỉ nhận duy nhất 1 tham số là `meta` 
        // Các cấu hình nâng cao như K và số cột Instance sẽ được builder xử lý động trong runtime.
        BaseCircuitBuilder::<Fr>::configure(meta)
    }

    fn synthesize(
        &self,
        config: Self::Config,
        layouter: impl Layouter<Fr>,
    ) -> Result<(), Error> {
        let builder = self.create_builder();
        builder.synthesize(config, layouter)
    }
}






