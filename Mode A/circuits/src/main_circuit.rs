    // use crate::config::Config;
    // use crate::note::Note;
    // use halo2_proofs::{
    //     circuit::{Layouter, SimpleFloorPlanner, Value},
    //     plonk::{Circuit, ConstraintSystem, Error},
    // };

    // use halo2_gadgets::poseidon::{
    //     primitives::{ConstantLength, P128Pow5T3},
    //     Hash,
    //     Pow5Chip,
    // };

    // use pasta_curves::pallas::Base as Fp;
    //  

    // #[derive(Clone, Debug)]
    // pub struct MyCircuit {
    //     pub student_id: Value<Fp>, // Value thì chỉ có Value<Fp> thôi, chỉ nhận field element (pasta_curves::pallas::Base as Fp;)
    //     pub scholarship_amount: Value<Fp>,
    //     pub rho: Value<Fp>,

    //     pub path_siblings: Vec<Value<Fp>>,
    //     pub path_directions: Vec<bool>,
    //     pub root: Value<Fp>,
    // }

    // impl Circuit<Fp> for MyCircuit {
        
    //     type Config = Config;
    //     type FloorPlanner = SimpleFloorPlanner;

    //     // Create circuit without witness (used in setup / verifier)
    //     fn without_witnesses(&self) -> Self {
    //         Self {
    //             student_id: Value::unknown(),
    //             scholarship_amount: Value::unknown(),
    //             rho: Value::unknown(),
    //             path_siblings: vec![],
    //             path_directions: vec![],
    //             root: Value::unknown(),
    //         }
    //     }
        
    //     // Define circuit structure (columns, future constraints)
    //     fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
    //         Config::configure(meta)
    //     }

    //     // Assign witness values to the circuit
    //     // fn synthesize(
    //     //     &self,
    //     //     config: Self::Config,
    //     //     mut layouter: impl Layouter<Fp>,
    //     // ) -> Result<(), Error> {
    //     //     let hash_cell = layouter.assign_region(
    //     //         || "poseidon constraint",
    //     //         |mut region| {
    //     //             let student_id = region.assign_advice(
    //     //                 || "student_id",
    //     //                 config.poseidon.a,
    //     //                 0,
    //     //                 || self.student_id,
    //     //             )?;

    //     //             let scholarship_amount = region.assign_advice(
    //     //                 || "scholarship_amount",
    //     //                 config.poseidon.b,
    //     //                 0,
    //     //                 || self.scholarship_amount,
    //     //             )?;

    //     //             let rho = region.assign_advice(
    //     //                 || "rho",
    //     //                 config.poseidon.c,
    //     //                 0,
    //     //                 || self.rho,
    //     //             )?;

                

                    
                    
                    
    //     //             let hash = region.assign_advice(
    //     //                 || "hash",
    //     //                 config.poseidon.out,
    //     //                 0,
    //     //                 || self.student_id
    //     //                     .zip(self.scholarship_amount)
    //     //                     .zip(self.rho)
    //     //                     .map(|((s, a), r)| s + a + r),
    //     //             )?;

                    

            
    //     //             config.poseidon.selector.enable(&mut region, 0)?;
    //     //             Ok(hash)



    //     //             Ok(())
    //     //         },
    //     //     )
    //     // }

    //     fn synthesize(
    //         &self,
    //         config: Self::Config,
    //         mut layouter: impl Layouter<Fp>,
    //     ) -> Result<(), Error> {

    //         // =========================
    //         // REGION 1: PRIVATE INPUTS
    //         // =========================
    //         // let hash_cell = layouter.assign_region(
    //         //     || "poseidon constraint",
    //         //     |mut region| {

    //         //         let student_id = region.assign_advice(
    //         //             || "student_id",
    //         //             config.poseidon.a,
    //         //             0,
    //         //             || self.student_id,
    //         //         )?;

    //         //         let scholarship_amount = region.assign_advice(
    //         //             || "scholarship_amount",
    //         //             config.poseidon.b,
    //         //             0,
    //         //             || self.scholarship_amount,
    //         //         )?;

    //         //         let rho = region.assign_advice(
    //         //             || "rho",
    //         //             config.poseidon.c,
    //         //             0,
    //         //             || self.rho,
    //         //         )?;

    //         //         // =========================
    //         //         // FIX HASH (HIỆN TẠI LÀ FAKE)
    //         //         // =========================
    //         //         let hash = region.assign_advice(
    //         //             || "hash",
    //         //             config.poseidon.out,
    //         //             0,
    //         //             || {
    //         //                 self.student_id
    //         //                     .zip(self.scholarship_amount)
    //         //                     .zip(self.rho)
    //         //                     .map(|((s, a), r)| poseidon_hash(s, a, r))
    //         //             },
    //         //         )?;

    //         //         config.poseidon.selector.enable(&mut region, 0)?;

    //         //         Ok(hash)
    //         //     },
    //         // )?;



    //         // let hash_cell: halo2_proofs::circuit::AssignedCell<Fp, Fp> = layouter.assign_region(
    //         //     || "poseidon hash",
    //         //     |mut region| {
    //         //         let chip = Pow5Chip::<Fp, 3, 2>::construct(
    //         //             config.poseidon.pow5_config.clone()
    //         //         );

    //         //         let message = [
    //         //             self.student_id,
    //         //             self.scholarship_amount,
    //         //             self.rho    
    //         //         ];

    //         //         let hasher = Hash::<
    //         //             _,
    //         //             _,
    //         //             P128Pow5T3,
    //         //             ConstantLength<3>,
    //         //             3,
    //         //             2
    //         //         >::init(chip, &mut region)?;

    //         //         // let hash = chip.hash(
    //         //         //     &mut region,
    //         //         //     message
    //         //         // )?;

    //         //         let hash = hasher.hash(message)?;

    //         //         Ok(hash)
    //         //     }
    //         // )?;

    //         let a_cell = layouter.assign_region(
    //             || "load inputs",
    //             |mut region| {
    //                 let a = region.assign_advice(
    //                     || "student_id",
    //                     config.poseidon.state[0],
    //                     0,
    //                     || self.student_id,
    //                 )?;

    //                 let b = region.assign_advice(
    //                     || "amount",
    //                     config.poseidon.state[1],
    //                     0,
    //                     || self.scholarship_amount,
    //                 )?;

    //                 let c = region.assign_advice(
    //                     || "rho",
    //                     config.poseidon.state[2],
    //                     0,
    //                     || self.rho,
    //                 )?;

    //                 Ok([a, b, c])
    //             },
    //         )?;

    //         let chip = Pow5Chip::<Fp, 3, 2>::construct(config.poseidon.pow5_config.clone());

    //         let hasher = Hash::<
    //             Fp,
    //             Pow5Chip<Fp, 3, 2>,
    //             P128Pow5T3,
    //             ConstantLength<3>,
    //             3,
    //             2,
    //         >::init(
    //             chip,
    //             layouter.namespace(|| "poseidon init"),
    //         )?;


    //         println!("input 0 = {:?}", a_cell[0].value());
    //         println!("input 1 = {:?}", a_cell[1].value());
    //         println!("input 2 = {:?}", a_cell[2].value());

    //         let hash_cell = hasher.hash(
    //             layouter.namespace(|| "poseidon hash"),
    //             a_cell.clone(),
    //         )?;


            
    //         println!("hash in circuit = {:?}", hash_cell.value());


    //         // | Row | state[0] | state[1] | state[2] |
    //         // | 0   | 24560002 | 2        | 1234567  |



    //         // | Row | state[0]   | state[1] | state[2] |
    //         // | 0   | student_id | amount   | rho      |
    //         // | 1   | round1_a   | round1_b | round1_c |
    //         // | 2   | round2_a   | round2_b | round2_c |
    //         // | ... | ...        | ...      | ...      |
    //         // | n   | leaf       | x        | y        |







    //         // =========================
    //         // CONSTRAINT CHECK
    //         // =========================
    //         layouter.constrain_instance(
    //             hash_cell.cell(),
    //             config.instance,
    //             0
    //         )?;

    //         Ok(())

    //         // | Row | instance |
    //         // | 0   | leaf     |


    //     }
    // }

    // // Tests
    // #[cfg(test)]
    // mod tests {
    //     use super::*;
    //     use halo2_proofs::dev::MockProver;

    //     #[test]
    //     fn test_commitment() {
    //         let note = Note::new(
    //             Fp::from(24560002),
    //             Fp::from(2),
    //             Fp::from(1234567)
    //         );

    //         let circuit = MyCircuit {
    //             student_id: Value::known(note.student_id),
    //             scholarship_amount: Value::known(note.scholarship_amount),
    //             rho: Value::known(note.rho),
            
    //         };

            
            
    //         // let leaf = commitment(note.student_id, note.scholarship_amount, note.rho);
    //         // let leaf = Fp::from(9);
    //         let leaf = commitment(note.student_id, note.scholarship_amount, 1234567.into());
    //         // println!("circuit: {:?}", circuit);
    //         println!("\n");
    //         println!("leaf: {:?}", leaf);

    //         let k = 8;

    //         let prover = MockProver::run(k, &circuit, vec![vec![leaf]]).unwrap();
    //         prover.assert_satisfied();
    //     }
    // }














    use crate::config::Config;
    use halo2_proofs::{
        circuit::{Layouter, SimpleFloorPlanner, Value},
        plonk::{Circuit, ConstraintSystem, Error},
    };

    use halo2_gadgets::poseidon::{
        primitives::{ConstantLength, P128Pow5T3},
        Hash,
        Pow5Chip,
    };

    // use pasta_curves::pallas::Base as Fp;
    use pasta_curves::Fp;

    #[derive(Clone, Debug)]
    pub struct MyCircuit {
        pub student_id: Value<Fp>,
        pub scholarship_amount: Value<Fp>,
        pub rho: Value<Fp>,

        // A25 — ví nhận tiền, public input thứ 4.
        pub recipient: Value<Fp>,

        // Merkle
        pub path_siblings: Vec<Value<Fp>>,
        pub path_directions: Vec<bool>,

        // public input
        // pub root: Value<Fp>,

        // pub nullifier: Value<Fp>,
        // pub address: Value<Fp>,
    }






    impl Circuit<Fp> for MyCircuit {
        type Config = Config;
        type FloorPlanner = SimpleFloorPlanner;

        fn without_witnesses(&self) -> Self {
            Self {
                student_id: Value::unknown(),
                scholarship_amount: Value::unknown(),
                rho: Value::unknown(),
                recipient: Value::unknown(),
                // path_siblings: vec![],
                path_siblings: vec![Value::unknown(); self.path_siblings.len()],
                // path_directions: vec![],
                path_directions: vec![false; self.path_directions.len()]
                // root: Value::unknown(),
                // nullifier: Value::unknown(),
                // address: Value::unknown(),
            }
        }

        fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
            Config::configure(meta)
        }

        fn synthesize(
            &self,
            config: Self::Config,
            mut layouter: impl Layouter<Fp>,
        ) -> Result<(), Error> {

            // =========================
            // 1. LOAD PRIVATE INPUT
            // =========================
            let (inputs, recipient_cell) = layouter.assign_region(
                || "load inputs",
                |mut region| {
                    let a = region.assign_advice(
                        || "student_id",
                        config.poseidon.state[0],
                        0,
                        || self.student_id,
                    )?;

                    let b = region.assign_advice(
                        || "amount",
                        config.poseidon.state[1],
                        0,
                        || self.scholarship_amount,
                    )?;

                    let c = region.assign_advice(
                        || "rho",
                        config.poseidon.state[2],
                        0,
                        || self.rho,
                    )?;

                    /*
                     * A25 — ví nhận tiền. Cùng hàng 0 với ba ô trên
                     * nhưng ở cột merkle_current (đã bật equality), nên
                     * vùng này vẫn cao đúng 1 hàng: không tốn thêm hàng
                     * nào của cột Poseidon — cột quyết định K.
                     */
                    let d = region.assign_advice(
                        || "recipient",
                        config.merkle_current,
                        0,
                        || self.recipient,
                    )?;

                    Ok(([a, b, c], d))
                },
            )?;

            let amount_cell = inputs[1].clone();



            /*
             * NULLIFIER PHẢI BĂM ĐÚNG CELL `rho` ĐÃ VÀO COMMITMENT.
             *
             * Bản cũ gán `self.rho` LẦN THỨ HAI vào một region riêng
             * ("load nf inputs"). Hai cell đó không có copy constraint
             * nối nhau, nên mạch chỉ chứng minh được:
             *
             *     ∃ sid, amt, ρ₁, ρ₂, path :
             *         commitment(sid, amt, ρ₁) nằm trong cây root R
             *         ∧ H(ρ₂) = nullifier
             *
             * ρ₂ tự do ⇒ một note hợp lệ sinh được vô hạn nullifier
             * khác nhau ⇒ rút được nhiều lần. Prover trung thực điền
             * cùng giá trị nên lỗi không lộ ra khi chạy bình thường;
             * chỉ prover bị sửa mới khai thác được.
             *
             * Định nghĩa chuẩn đòi nullifier sinh ra từ ĐÚNG bí mật đã
             * tạo commitment — Zcash Protocol Spec §4.16 (`ρ` lấy từ
             * chính note đã chứng minh nằm trong cây), Tornado Cash
             * `withdraw.circom` (cùng một signal `nullifier` đi vào cả
             * CommitmentHasher lẫn NullifierHasher).
             *
             * `Hash::hash` copy cell vào region Poseidon bằng copy
             * constraint, nên dùng lại `inputs[2]` là đủ để ràng buộc.
             * Cùng khuôn với `amount_cell` ở trên.
             */
            let nf_input = inputs[2].clone();

            let chip = Pow5Chip::<Fp, 3, 2>::construct(config.poseidon.pow5_config.clone());

            let hasher = Hash::<
                Fp,
                Pow5Chip<Fp, 3, 2>,
                P128Pow5T3,
                ConstantLength<1>,
                3,
                2,
            >::init(
                chip,
                layouter.namespace(|| "nf init"),
            )?;

            let nf_cell = hasher.hash(
                layouter.namespace(|| "nf hash"),
                [nf_input]
            )?;

            eprintln!("nullifier in circuit = {:?}", nf_cell.value());








            // =========================
            // 2. POSEIDON HASH (LEAF)
            // =========================
            let chip = Pow5Chip::<Fp, 3, 2>::construct(config.poseidon.pow5_config.clone());

            let hasher = Hash::<
                Fp,
                Pow5Chip<Fp, 3, 2>,
                P128Pow5T3,
                ConstantLength<3>,
                3,
                2,
            >::init(
                chip,
                layouter.namespace(|| "poseidon init"),
            )?;

            let leaf = hasher.hash(
                layouter.namespace(|| "poseidon hash"),
                inputs,
            )?;

            eprintln!("leaf in circuit = {:?}", leaf.value());

            // =========================
            // 3. MERKLE VERIFY
            // =========================
            let mut current = leaf;

            for (i, (sibling_val, direction)) in self.path_siblings
                .iter()
                .zip(self.path_directions.iter())
                .enumerate()
            {
                // // load sibling
                // let sibling = layouter.assign_region(
                //     || format!("sibling {}", i),
                //     |mut region| {
                //         let s = region.assign_advice(
                //             || "sibling",
                //             config.poseidon.state[0],
                //             0,
                //             || *sibling_val,
                //         )?;
                //         Ok(s)
                //     },
                // )?;



                // Chuyển bool thành field element.
    //
    // false → 0
    // true  → 1
    //
    // Đây chỉ là tạo giá trị witness.
    // Nó không còn chọn nhánh circuit.
                let direction_fp =
                    Fp::from(
                        (*direction) as u64
                    );


                // =========================
                // SELECT LEFT / RIGHT
                // INSIDE CIRCUIT
                // =========================
                let (
                    left,
                    right,
                ) = layouter.assign_region(
                    || format!(
                        "select merkle left right {}",
                        i
                    ),

                    |mut region| {
                        // Bật các constraint:
                        //
                        // d(d - 1) = 0
                        //
                        // left =
                        // current + d(sibling-current)
                        //
                        // right =
                        // sibling + d(current-sibling)
                        config
                            .q_merkle_select
                            .enable(
                                &mut region,
                                0,
                            )?;


                        // Copy output của hash trước
                        // vào region chọn left/right.
                        //
                        // Copy constraint đảm bảo
                        // current_copy thật sự bằng current.
                        let current_copy =
                            current.copy_advice(
                                || "copy current",

                                &mut region,

                                config.merkle_current,

                                0,
                            )?;


                        // Gán sibling private witness.
                        let sibling =
                            region.assign_advice(
                                || "merkle sibling",

                                config.merkle_sibling,

                                0,

                                || *sibling_val,
                            )?;


                        // Gán direction private witness.
                        //
                        // direction này sẽ bị gate kiểm tra
                        // bắt buộc phải là 0 hoặc 1.
                        let _direction_cell =
                            region.assign_advice(
                                || "merkle direction",

                                config.merkle_direction,

                                0,

                                || Value::known(
                                    direction_fp
                                ),
                            )?;


                        // Các Value dưới đây chỉ là witness
                        // mà prover đề xuất.
                        //
                        // Custom gate phía config.rs mới là
                        // phần đảm bảo chúng đúng.
                        let left_value =
                            current_copy
                                .value()
                                .zip(
                                    sibling.value()
                                )
                                .map(
                                    |(
                                        current_value,
                                        sibling_value,
                                    )| {
                                        *current_value
                                            + direction_fp
                                                * (
                                                    *sibling_value
                                                        - *current_value
                                                )
                                    },
                                );


                        let right_value =
                            current_copy
                                .value()
                                .zip(
                                    sibling.value()
                                )
                                .map(
                                    |(
                                        current_value,
                                        sibling_value,
                                    )| {
                                        *sibling_value
                                            + direction_fp
                                                * (
                                                    *current_value
                                                        - *sibling_value
                                                )
                                    },
                                );


                        let left =
                            region.assign_advice(
                                || "selected left",

                                config.merkle_left,

                                0,

                                || left_value,
                            )?;


                        let right =
                            region.assign_advice(
                                || "selected right",

                                config.merkle_right,

                                0,

                                || right_value,
                            )?;


                        Ok((
                            left,
                            right,
                        ))
                    },
                )?;







                let chip = Pow5Chip::<Fp, 3, 2>::construct(
                    config.poseidon.pow5_config.clone()
                );

                // let zero_cell = layouter.assign_region(
                //     || "load zero",
                //     |mut region| {
                //         let z = region.assign_advice(
                //             || "zero",
                //             config.poseidon.state[0], // dùng cột nào cũng được
                //             0,
                //             || Value::known(Fp::zero()),
                //         )?;
                //         Ok(z)
                //     },
                // )?;

                // Poseidon cho level này
                let hasher = Hash::<
                    Fp,
                    Pow5Chip<Fp, 3, 2>,
                    P128Pow5T3,
                    ConstantLength<2>,
                    3,
                    2,
                >::init(
                    chip,
                    layouter.namespace(|| format!("merkle init {}", i)),
                )?;

                // left / right
                // let merkle_inputs = if *direction {
                //     // current là RIGHT
                //     [sibling.clone(), current.clone()]
                // } else {
                //     // current là LEFT
                //     [current.clone(), sibling.clone()]
                // };







                current = hasher.hash(
                    layouter.namespace(|| format!("merkle hash {}", i)),
                    [left, right]
                    // merkle_inputs,
                )?;
            }

            eprintln!("computed root = {:?}", current.value());


            // let address_cell = layouter.assign_region(
            //     || "load address",
            //     |mut region| {
            //         let addr = region.assign_advice(
            //             || "address",
            //             config.poseidon.state[0],
            //             0,
            //             || self.address,
            //         )?;
            //         Ok(addr)
            //     },
            // )?;


            // =========================
            // 4. CONSTRAINT ROOT (PUBLIC)
            // =========================
            layouter.constrain_instance(
                current.cell(),
                config.instance,
                0,
            )?;

            layouter.constrain_instance(
                nf_cell.cell(),
                config.instance,
                1, // 👈 index 1
            )?;

            layouter.constrain_instance(
                amount_cell.cell(),
                config.instance,
                2,
            )?;

            /*
             * A25 — ràng buộc ví nhận vào hàng 3 của cột instance.
             * Ô này không đi vào phép băm nào: nó chỉ bị copy
             * constraint buộc bằng giá trị công khai, và thế là đủ
             * để đổi ví thì proof hỏng.
             */
            layouter.constrain_instance(
                recipient_cell.cell(),
                config.instance,
                3,
            )?;

            Ok(())
        }
    }




    impl Default for MyCircuit {

        fn default() -> Self {

            Self {

                student_id:
                    Value::unknown(),

                scholarship_amount:
                    Value::unknown(),

                rho:
                    Value::unknown(),

                recipient:
                    Value::unknown(),

                path_siblings:
                    vec![
                        Value::unknown();
                        3
                    ],

                path_directions:
                    vec![
                        false;
                        3
                    ],

                // root:
                //     Value::unknown(),

                // nullifier:
                //     Value::unknown(),

                // address:
                //     Value::unknown(),
            }
        }
    }

    // =========================
    // TEST
    // =========================
    // #[cfg(test)]
    // mod tests {
    //     use super::*;
    //     use halo2_proofs::dev::MockProver;
    //     use crate::merkle_tree::MerkleTree;
    //     use crate::note::Note;
    //     use crate::commitment::commitment;
    //     use crate::nullifier::nullifier;

    //     #[test]
    //     fn test_commitment() {
    //         let note = Note::new(
    //             Fp::from(24560002),
    //             Fp::from(2),
    //             Fp::from(1234567),
    //         );

    //         let note1 = Note::new(
    //             Fp::from(23560056),
    //             Fp::from(2),
    //             Fp::from(7654321),
    //         );

    //         let leaf = commitment(note.student_id, note.scholarship_amount, note.rho);
    //         let leaf1 = commitment(note1.student_id, note1.scholarship_amount, note1.rho);
    //         let nf = nullifier(&note); 
    //         let nf1 = nullifier(&note1);

    //         // build REAL tree
    //         let mut tree = MerkleTree::new(3);
    //         tree.insert(leaf);
    //         tree.insert(leaf1);

    //         let root = tree.root();
    //         let (siblings, directions) = tree.get_path(1);

    //         let circuit = MyCircuit {
    //             student_id: Value::known(note1.student_id), 
    //             scholarship_amount: Value::known(note1.scholarship_amount),
    //             rho: Value::known(note1.rho),

    //             path_siblings: siblings.into_iter().map(Value::known).collect::<Vec<Value<Fp>>>(),
    //             path_directions: directions,
    //             root: Value::known(root),
    //             nullifier: Value::known(nf1),
    //         };

    //         eprintln!("========================");
    //         eprintln!("Circuit");
    //         eprintln!("========================");
    //         eprintln!("{:#?}", circuit);
    //         eprintln!("========================");
    //         eprintln!("leaf off circuit: {:?} \n", leaf);
    //         eprintln!("nullifier off circuit = {:?} \n", nf);
    //         eprintln!("leaf1 off circuit: {:?} \n", leaf1);
    //         eprintln!("nullifier1 off circuit = {:?} \n", nf1);
    //         eprintln!("root = {:?}", root);

    //         let prover = MockProver::run(10, &circuit, vec![vec![root, nf1, address]]).unwrap();
    //         prover.assert_satisfied();
    //     }
    // }












    