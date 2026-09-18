// // prover/src/inputs_builder.rs

// use halo2_base::{
//     gates::{
//         circuit::builder::BaseCircuitBuilder,
//         flex_gate::GateChip,
//     },
//     halo2_proofs::halo2curves::bn256::Fr,
// };

// use circuits::{
//     note::Note,
//     poseidon::PoseidonChip,
//     commitment::CommitmentChip,
//     merkle_tree::MerkleTree,
//     circuit::{
//         ScholarshipCircuit,
//         NoteNative,
//     },
// };

// fn commitment_from_note(
//     note: &NoteNative,
// ) -> Fr {

//     let mut builder =
//         BaseCircuitBuilder::<Fr>::new(false);

//     let mut ctx =
//         builder.main(0);

//     let gate =
//         GateChip::<Fr>::new();

//     let mut hasher =
//         PoseidonChip::new_hasher();

//     let circuit_note =
//         Note {

//             student_id:
//                 ctx.load_witness(
//                     note.student_id
//                 ),

//             amount:
//                 ctx.load_witness(
//                     note.amount
//                 ),

//             rho:
//                 ctx.load_witness(
//                     note.rho
//                 ),
//         };

//     let commitment =
//         CommitmentChip::create_commitment(
//             &mut ctx,
//             &gate,
//             &mut hasher,
//             &circuit_note,
//         );

//     *commitment.value()
// }

// fn nullifier_from_note(
//     rho: Fr,
// ) -> Fr {

//     let mut builder =
//         BaseCircuitBuilder::<Fr>::new(false);

//     let mut ctx =
//         builder.main(0);

//     let gate =
//         GateChip::<Fr>::new();

//     let mut hasher =
//         PoseidonChip::new_hasher();

//     let rho_assigned =
//         ctx.load_witness(rho);

//     let nullifier =
//         CommitmentChip::create_nullifier(
//             &mut ctx,
//             &gate,
//             &mut hasher,
//             rho_assigned,
//         );

//     *nullifier.value()
// }

// pub fn build_inputs()
// -> ScholarshipCircuit {

//     // =========================
//     // NOTES
//     // =========================

//     let note1 =
//         NoteNative {

//             student_id:
//                 Fr::from(24560002),

//             amount:
//                 Fr::from(2),

//             rho:
//                 Fr::from(1234567),
//         };

//     let note2 =
//         NoteNative {

//             student_id:
//                 Fr::from(24560003),

//             amount:
//                 Fr::from(3),

//             rho:
//                 Fr::from(1234568),
//         };

//     // =========================
//     // COMMITMENTS
//     // =========================

//     let commitment1 =
//         commitment_from_note(
//             &note1
//         );

//     let commitment2 =
//         commitment_from_note(
//             &note2
//         );

//     eprintln!(
//         "commitment1 = {:?}",
//         commitment1
//     );

//     eprintln!(
//         "commitment2 = {:?}",
//         commitment2
//     );

//     // =========================
//     // MERKLE TREE
//     // =========================

//     let mut tree =
//         MerkleTree::new(3);

//     tree.insert(
//         commitment1
//     );

//     tree.insert(
//         commitment2
//     );

//     // =========================
//     // WITNESS
//     // =========================

//     let witness =
//         tree.create_witness(0);

//     eprintln!(
//         "root = {:?}",
//         witness.root
//     );

//     // =========================
//     // NULLIFIER
//     // =========================

//     let nullifier =
//         nullifier_from_note(
//             note1.rho
//         );

//     eprintln!(
//         "nullifier = {:?}",
//         nullifier
//     );

//     // =========================
//     // CIRCUIT INPUT
//     // =========================

//     ScholarshipCircuit::new(

//         note1,

//         witness.clone(),

//         witness.root,

//         nullifier,
//     )
// }









// use halo2_base::halo2_proofs::halo2curves::bn256::Fr;
use halo2_base::halo2_proofs::{
    halo2curves::{
        bn256::Fr,
        ff::PrimeField,
    },
};
use circuits::{
    merkle_tree::MerkleTree,
    circuit::{
        ScholarshipCircuit,
        NoteNative,
    },
};
use std::io::{self, Read};
use serde::Deserialize;
use ff_ce::hex;

// #[derive(Deserialize)]
// struct StudentInput {
//     student_id: u64,
//     amount: u64,
//     rho: String
// }


#[derive(Deserialize, Clone)]
#[serde(untagged)]
enum DecimalInput {
    Number(u64),
    String(String),
}

#[derive(Deserialize)]
struct StudentInput {
    student_id: u64,

    // Hỗ trợ cả:
    // "10000000000000000"
    // và:
    // 2
    amount: DecimalInput,

    rho: String,

    // Có trong prove mode.
    // Không có trong root mode.
    #[serde(default)]
    expected_root:
        Option<String>,

    // A25 — vi nhan tien, public input thu 4.
    #[serde(default)]
    recipient:
        Option<String>,
}



fn decimal_string_to_fr(value: &str) -> Fr {
    let mut result =
        Fr::from(0);

    for byte in value.bytes() {
        if byte < b'0' || byte > b'9' {
            panic!("rho must be decimal string");
        }

        let digit =
            (byte - b'0') as u64;

        result =
            result * Fr::from(10)
            + Fr::from(digit);
    }

    result
}



fn decimal_input_to_fr(
    value: &DecimalInput
) -> Fr {
    match value {
        DecimalInput::Number(
            number
        ) => {
            Fr::from(
                *number
            )
        }

        DecimalInput::String(
            string
        ) => {
            decimal_string_to_fr(
                string
            )
        }
    }
}




fn bytes32_hex_to_fr(
    value: &str
) -> Fr {
    let raw =
        value
            .strip_prefix(
                "0x"
            )
            .unwrap_or(
                value
            );

    if raw.len() != 64 {
        panic!(
            "expected_root must be bytes32 hex"
        );
    }

    // EVM calldata:
    // big-endian 32 bytes
    let mut bytes =
        hex::decode(
            raw
        )
        .expect(
            "Invalid expected_root hex"
        );

    if bytes.len() != 32 {
        panic!(
            "expected_root must contain 32 bytes"
        );
    }

    // Fr::Repr của halo2curves
    // dùng thứ tự byte ngược với EVM.
    bytes.reverse();

    let mut repr =
        <Fr as PrimeField>::
            Repr::default();

    repr
        .as_mut()
        .copy_from_slice(
            &bytes
        );

    Option::<Fr>::from(
        Fr::from_repr(
            repr
        )
    )
    .expect(
        "expected_root is not a valid BN254 field element"
    )
}



// fn read_student_note_from_stdin() -> NoteNative {
//     let mut input =
//         String::new();

//     io::stdin()
//         .read_to_string(&mut input)
//         .unwrap();

//     if input.trim().is_empty() {
//         eprintln!(
//             "No stdin input found, using demo note"
//         );

//         return NoteNative {
//             student_id: Fr::from(24560002),
//             amount: Fr::from(2),
//             rho: Fr::from(12345678),
//         };
//     }

//     let student: StudentInput =
//         serde_json::from_str(&input)
//             .expect("Invalid student JSON input");

//     NoteNative {
//         student_id: Fr::from(student.student_id),
//         amount: Fr::from(student.amount),
//         rho: decimal_string_to_fr(&student.rho),
//     }
// }





fn read_student_from_stdin()
    -> StudentInput
{
    let mut input =
        String::new();

    io::stdin()
        .read_to_string(
            &mut input
        )
        .unwrap();

    if input.trim().is_empty() {
        eprintln!(
            "No stdin input found, using demo note"
        );

        return StudentInput {
            student_id:
                24560002,

            amount:
                DecimalInput::String(
                    "2".to_string()
                ),

            rho:
                "12345678"
                    .to_string(),

            expected_root:
                None,

            recipient:
                None,
        };
    }

    serde_json::from_str(
        &input
    )
    .expect(
        "Invalid student JSON input"
    )
}



pub fn build_inputs()
-> ScholarshipCircuit {

    // =========================
    // NOTES
    // =========================

    // let note1 =
    //     NoteNative {

    //         student_id:
    //             Fr::from(24560005),

    //         amount:
    //             Fr::from(2),

    //         rho:
    //             Fr::from(1234567890),
    //     };

    // let note1 = read_student_note_from_stdin();
    let student =
        read_student_from_stdin();

    let note1 =
        NoteNative {
            student_id:
                Fr::from(
                    student.student_id
                ),

            amount:
                decimal_input_to_fr(
                    &student.amount
                ),

            rho:
                decimal_string_to_fr(
                    &student.rho
                ),
        };

    let note2 =
        NoteNative {

            student_id:
                Fr::from(24560003),

            amount:
                Fr::from(3),

            rho:
                Fr::from(1234568),
        };

    // =========================
    // COMMITMENTS
    // =========================

    let commitment1 =
        ScholarshipCircuit::native_commitment(
            &note1
        );

    let commitment2 =
        ScholarshipCircuit::native_commitment(
            &note2
        );

    eprintln!(
        "commitment1 = {:?}",
        commitment1
    );

    eprintln!(
        "commitment2 = {:?}",
        commitment2
    );

    // =========================
    // MERKLE TREE
    // =========================

    let mut tree =
        MerkleTree::new(3);

    tree.insert(
        commitment1
    );

    tree.insert(
        commitment2
    );

    // =========================
    // WITNESS
    // =========================

    let witness =
        tree.create_witness(0);


    let local_root =
        witness.root;

    let public_root =
        match student
            .expected_root
            .as_ref()
        {   
            Some(
                expected_root_hex
            ) => {
                let root_from_contract =
                    bytes32_hex_to_fr(
                        expected_root_hex
                    );

                eprintln!(
                    "Local Merkle root = {:?}",
                    local_root
                );

                eprintln!(
                    "Root from contract = {:?}",
                    root_from_contract
                );

                if local_root
                    !=
                    root_from_contract
                {
                    panic!(
                        "Local Merkle root does not match currentRoot from smart contract"
                    );
                }

                root_from_contract
            }

            None => {
                // root mode:
                // chỉ tính root local
                local_root
            }
        };
    


    eprintln!(
        "root = {:?}",
        witness.root
    );

    // =========================
    // NULLIFIER
    // =========================

    let nullifier = 
        ScholarshipCircuit::native_nullifier(
            note1.rho
        );

    eprintln!(
        "nullifier = {:?}",
        nullifier
    );

    let fake_root =
        witness.root + Fr::from(123);

    // =========================
    // CIRCUIT INPUT
    // =========================

    // A25 — vi nhan tien, public input thu 4.
    let recipient =
        crate::flow_inputs::recipient_to_fr(
            student
                .recipient
                .as_deref()
                .expect("recipient is required in prove mode")
        );

    ScholarshipCircuit::new(
        note1,
        witness.clone(),
        // witness.root,
        public_root,
        nullifier,
        recipient,
    )
}



// =========================
// BUILD CIRCUIT FOR KEYGEN
//
// Không đọc stdin.
// Không phụ thuộc sinh viên thật.
// Chỉ tạo circuit có đúng shape.
// =========================

pub fn build_keygen_circuit()
    -> ScholarshipCircuit
{
    // Các giá trị này chỉ là dummy witness.
    // Chúng không bị khóa vào verifier.
    let note1 =
        NoteNative {
            student_id:
                Fr::from(1),

            amount:
                Fr::from(1),

            rho:
                Fr::from(1),
        };

    let note2 =
        NoteNative {
            student_id:
                Fr::from(2),

            amount:
                Fr::from(2),

            rho:
                Fr::from(2),
        };

    let commitment1 =
        ScholarshipCircuit::
            native_commitment(
                &note1
            );

    let commitment2 =
        ScholarshipCircuit::
            native_commitment(
                &note2
            );

    // Phải dùng đúng Merkle depth
    // của circuit runtime hiện tại.
    let mut tree =
        MerkleTree::new(3);

    tree.insert(
        commitment1
    );

    tree.insert(
        commitment2
    );

    let witness =
        tree.create_witness(0);

    let nullifier =
        ScholarshipCircuit::
            native_nullifier(
                note1.rho
            );

    ScholarshipCircuit::new(
        note1,
        witness.clone(),
        witness.root,
        nullifier,
        // Mach keygen chi can dung hinh dang.
        Fr::from(0),
    )
}




#[derive(Deserialize, Clone)]
pub struct ExperimentNoteInput {
    pub student_id: u64,
    pub amount: u64,
    pub rho: String,
}

#[derive(Deserialize, Clone)]
pub struct ExperimentStudentInput {
    pub student_index: usize,
    pub ganache_account_index: usize,
    pub address: String,
    pub student_id: u64,
    pub amount: u64,
    pub private_key: String,
    pub public_key: String,
    pub cid: String,
    pub preparation_ms: f64,
    pub note: ExperimentNoteInput,
}

#[derive(Deserialize, Clone)]
pub struct ExperimentDatasetInput {
    pub n: usize,
    pub merkle_depth: usize,
    pub school_account_index: usize,
    pub student_account_offset: usize,
    pub students: Vec<ExperimentStudentInput>,
}

pub fn experiment_note_to_native(
    note: &ExperimentNoteInput
) -> NoteNative {
    NoteNative {
        student_id:
            Fr::from(note.student_id),

        amount:
            Fr::from(note.amount),

        rho:
            decimal_string_to_fr(
                &note.rho
            ),
    }
}

/*
 * K10 — 03/09/2026: dung cay MOT LAN cho ca kich ban.
 *
 * Ban cu goi `build_circuit_from_experiment_dataset` trong
 * vong lap tung sinh vien, moi lan lai bam lai n commitment
 * roi chen lai n la  ->  n^2 x depth phep bam cho ca kich ban.
 *
 * Ham nay tach phan DUNG CAY ra ngoai vong lap. Luong that
 * sau K10 cung lam vay: `approveRoot` luu cay mot lan,
 * `createWithdrawalRequest` chi doc `depth` nut.
 */
pub fn build_experiment_tree(
    dataset: &ExperimentDatasetInput
) -> (MerkleTree, Vec<NoteNative>) {
    assert!(
        dataset.students.len() <= (1usize << dataset.merkle_depth),
        "Merkle tree depth is too small"
    );

    let notes: Vec<NoteNative> =
        dataset
            .students
            .iter()
            .map(|student| {
                experiment_note_to_native(
                    &student.note
                )
            })
            .collect();

    let mut tree =
        MerkleTree::new(
            dataset.merkle_depth
        );

    for note in notes.iter() {
        tree.insert(
            ScholarshipCircuit::native_commitment(
                note
            )
        );
    }

    (tree, notes)
}

/*
 * Lay witness cua mot sinh vien tu cay DA DUNG SAN.
 * Chi phi O(depth) — khong bam lai gi.
 */
pub fn build_circuit_from_tree(
    tree: &MerkleTree,
    notes: &[NoteNative],
    target_index: usize,
    // A25 — vi nhan tien, public input thu 4.
    recipient: Fr
) -> ScholarshipCircuit {
    assert!(
        target_index < notes.len(),
        "target_index out of range"
    );

    let witness =
        tree.create_witness(
            target_index
        );

    let target_note =
        NoteNative {
            student_id:
                notes[target_index].student_id,

            amount:
                notes[target_index].amount,

            rho:
                notes[target_index].rho,
        };

    let nullifier =
        ScholarshipCircuit::native_nullifier(
            target_note.rho
        );

    ScholarshipCircuit::new(
        target_note,
        witness.clone(),
        witness.root,
        nullifier,
        recipient,
    )
}

/*
 * Duong cu: dung cay roi lay witness trong MOT lan goi.
 * Giu lai vi `export-verifier-from-dataset` va cac lenh khac
 * van dung, va de so sanh doi chung voi duong moi.
 */
pub fn build_circuit_from_experiment_dataset(
    dataset: &ExperimentDatasetInput,
    target_index: usize
) -> ScholarshipCircuit {
    assert!(
        target_index < dataset.students.len(),
        "target_index out of range"
    );

    // A25 — vi nhan tien lay dung dia chi sinh vien trong dataset.
    let recipient =
        crate::flow_inputs::recipient_to_fr(
            &dataset.students[target_index].address
        );

    assert!(
        dataset.students.len() <= (1usize << dataset.merkle_depth),
        "Merkle tree depth is too small"
    );

    let notes: Vec<NoteNative> =
        dataset
            .students
            .iter()
            .map(|student| {
                experiment_note_to_native(
                    &student.note
                )
            })
            .collect();

    let mut tree =
        MerkleTree::new(
            dataset.merkle_depth
        );

    for note in notes.iter() {
        let commitment =
            ScholarshipCircuit::native_commitment(
                note
            );

        tree.insert(
            commitment
        );
    }

    let witness =
        tree.create_witness(
            target_index
        );

    let target_note =
        NoteNative {
            student_id:
                notes[target_index].student_id,

            amount:
                notes[target_index].amount,

            rho:
                notes[target_index].rho,
        };  

    let nullifier =
        ScholarshipCircuit::native_nullifier(
            target_note.rho
        );

    ScholarshipCircuit::new(
        target_note,
        witness.clone(),
        witness.root,
        nullifier,
        recipient,
    )
}