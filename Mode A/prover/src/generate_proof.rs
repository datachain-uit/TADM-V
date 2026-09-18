use std::io::{
    self,
    Read,
};

use std::time::Instant;

use rand_core::OsRng;
use serde::{Serialize, Deserialize};
use std::fs;

use halo2_proofs::{
    plonk::{
        verify_proof,
        SingleVerifier,
    },

    transcript::{
        Blake2bRead,
    },
};


use halo2_proofs::{
    circuit::Value,

    plonk::{
        create_proof,
        keygen_pk,
        keygen_vk,
    },

    poly::commitment::Params,

    transcript::{
        Blake2bWrite,
        Challenge255,
    },
};

// use crate::utils::{fp_to_hex};
use crate::utils::{
    fp_to_hex,
    hex_to_fp,
};

use pasta_curves::{
    pallas,
    vesta,
};

use circuits::main_circuit::MyCircuit;
use circuits::{
    commitment::commitment,
    merkle_tree::MerkleTree,
    nullifier::nullifier,
};

// use crate::inputs_builder::build_inputs;
use crate::inputs_builder::{
    build_inputs,
    build_inputs_from,
    build_note_only,
    merkle_depth,
    StudentData,
};

#[derive(
    Serialize,
    Deserialize
)]
pub struct CommitmentOutput {
    pub commitment:
        String,
}


#[derive(
    Serialize,
    Deserialize
)]
pub struct NullifierOutput {
    pub nullifier:
        String,
}


// =========================
// SETUP / VERIFY (A2)
//
// K là bậc của circuit. Đổi K hoặc đổi
// MERKLE_DEPTH đều làm params/vk khác đi,
// nên phải chạy lại mode setup.
// =========================

/*
 * K = 9 — GIA TRI NHO NHAT MA MACH CON HOP LE.
 *
 * Chon bang cach ha dan cho toi khi bao loi, khong lay tron cho tien:
 *
 *     k = 8  ->  keygen_vk that bai:
 *                NotEnoughRowsAvailable { current_k: 8 }
 *     k = 9  ->  chay duoc, proof verify duoc
 *
 * Do duoc khi doi 10 -> 9 (n = 1, cung mot input):
 *
 *     proof        3 168 -> 3 104 byte      (-2 %)
 *     prove_ms       473 ->   397 ms        (-16 %)
 *     setup_ms       297 ->   232 ms        (-22 %)
 *     verify_ms     14,5 ->  12,0 ms        (-17 %)
 *     params.bin  65 604 -> 32 836 byte     (-50 %)
 *
 * Tot hon o MOI mat, va quan trong hon: con so nay SUY RA DUOC.
 * "k = 9 vi k = 8 bao loi" la lap luan bao ve duoc truoc phan bien;
 * "k = 10" thi khong giai thich duoc vi sao khong phai 9 hay 11.
 *
 * ⚠️ K sat nguong: doi MERKLE_DEPTH la phai chon lai K tu dau theo
 * dung cach tren. Dieu nay von da dung voi K = 10, khong phai rui ro
 * moi sinh ra.
 *
 * Nhanh on-chain doc lap: no dung k = 13, cung la nguong toi thieu
 * (k = 12 bao "NOT ENOUGH ADVICE COLUMNS. max non-poisoned rows is
 * 4087"). Hai con so k KHONG so sanh duoc voi nhau — hai mach khac
 * han, xem code/DINH_NGHIA_PHEP_DO.md muc 6b.
 */
pub const K: u32 = 9;

const PARAMS_PATH: &str =
    "../shared/params.bin";

/*
 * LAP20 (14/09/2026) — thi nghiem theo d phai doi K LUC CHAY.
 *
 * `HALO2_K` ghi de K; KHONG dat bien thi dung K = 9 nhu cu. Moi d phai tim
 * lai K nho nhat dung cach ghi o tren (xem mode `check-k`), nen runner dat
 * bien nay rieng cho tung d.
 *
 * Gia tri sai => panic, khong lang le quay ve 9.
 */
pub fn k() -> u32 {
    match std::env::var("HALO2_K") {
        Err(_) => K,

        Ok(gia_tri) => {
            let k_doc: u32 =
                gia_tri
                    .trim()
                    .parse()
                    .unwrap_or_else(|_| {
                        panic!("HALO2_K khong hop le: {:?}", gia_tri)
                    });

            if !(4..=20).contains(&k_doc) {
                panic!("HALO2_K ngoai khoang 4..=20: {}", k_doc);
            }

            k_doc
        }
    }
}

/*
 * Params IPA chi phu thuoc K. K mac dinh dung lai `shared/params.bin`
 * (git dang theo doi file nay). K khac ghi ra `target/` — da nam trong
 * .gitignore — de lap20 khong sinh file la trong `shared/` va KHONG BAO GIO
 * ghi de params cua luong that.
 */
fn params_path() -> String {
    let k_hien_tai =
        k();

    if k_hien_tai == K {
        PARAMS_PATH.to_string()
    } else {
        format!(
            "../target/params_k{}.bin",
            k_hien_tai
        )
    }
}


/*
 * Circuit rỗng witness, chỉ đúng shape.
 *
 * keygen_vk chỉ phụ thuộc shape (số cột cố
 * định, selector, permutation), không phụ
 * thuộc giá trị witness — nên vk dựng từ đây
 * trùng với vk dùng lúc tạo proof, miễn là
 * MERKLE_DEPTH không đổi.
 */
fn shape_only_circuit() -> MyCircuit {
    MyCircuit {
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
                merkle_depth()
            ],

        path_directions:
            vec![
                false;
                merkle_depth()
            ],
    }
}


/*
 * Đọc params từ shared/params.bin.
 * Nếu chưa có thì sinh rồi ghi lại, để lần
 * sau không phải sinh lại nữa.
 */
fn load_or_create_params()
    -> Params<vesta::Affine>
{
    if let Ok(bytes) =
        fs::read(
            params_path()
        )
    {
        if let Ok(params) =
            Params::read(
                &mut &bytes[..]
            )
        {
            eprintln!(
                "Params loaded from {}",
                params_path()
            );

            return params;
        }

        eprintln!(
            "Params file is unreadable, regenerating"
        );
    }

    let params: Params<vesta::Affine> =
        Params::new(k());

    let mut bytes =
        Vec::new();

    params
        .write(
            &mut bytes
        )
        .expect(
            "Không serialize được params"
        );

    fs::write(
        params_path(),
        &bytes,
    )
    .expect(
        "Không ghi được file params"
    );

    eprintln!(
        "Params generated and written to {}",
        params_path()
    );

    params
}


#[derive(Serialize)]
pub struct SetupOutput {
    pub k:
        u32,

    pub merkle_depth:
        usize,

    pub params_file:
        String,

    pub params_bytes:
        usize,

    pub setup_ms:
        f64,
}


/*
 * MODE: SETUP
 *
 * Sinh và lưu params một lần. Chạy lại khi
 * đổi K hoặc MERKLE_DEPTH.
 */
pub fn run_setup() {
    let started =
        Instant::now();

    // Xóa file cũ để luôn sinh lại từ đầu.
    let _ =
        fs::remove_file(
            params_path()
        );

    let params =
        load_or_create_params();

    // Dựng thử vk để chắc chắn params khớp
    // circuit hiện tại.
    let _vk =
        keygen_vk(
            &params,
            &shape_only_circuit(),
        )
        .expect(
            "keygen_vk thất bại với params vừa sinh"
        );

    let setup_ms =
        started
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    let params_bytes =
        fs::metadata(
            params_path()
        )
        .map(
            |m| m.len() as usize
        )
        .unwrap_or(0);

    let output =
        SetupOutput {
            k: k(),

            merkle_depth:
                merkle_depth(),

            params_file:
                params_path(),

            params_bytes,

            setup_ms,
        };

    println!(
        "{}",
        serde_json::to_string(
            &output
        ).unwrap()
    );

    eprintln!(
        "SETUP COMPLETED - NO PROOF CREATED"
    );
}


/*
 * MODE: CHECK-K (LAP20, 14/09/2026)
 *
 * Kiem K hien tai (`HALO2_K`) co du hang cho mach o do sau hien tai
 * (`MERKLE_DEPTH`) khong — DUNG phep thu da dung de chon K = 9: keygen_vk
 * tren mach rong witness, thieu hang thi bao NotEnoughRowsAvailable.
 *
 * KHAC `setup`: KHONG xoa file params, nen goi lap lai voi nhieu K khong
 * dung toi `shared/params.bin`. Thieu hang => panic, ma thoat khac 0 —
 * runner doc ma thoat de tim K nho nhat.
 */
#[derive(Serialize)]
pub struct CheckKOutput {
    pub k:
        u32,

    pub merkle_depth:
        usize,

    pub ok:
        bool,

    pub check_ms:
        f64,
}


pub fn run_check_k() {
    let started =
        Instant::now();

    let params =
        load_or_create_params();

    let ket_qua =
        keygen_vk(
            &params,
            &shape_only_circuit(),
        );

    if let Err(error) = ket_qua {
        panic!(
            "K = {} khong du cho MERKLE_DEPTH = {}: {:?}",
            k(),
            merkle_depth(),
            error
        );
    }

    let output =
        CheckKOutput {
            k: k(),

            merkle_depth:
                merkle_depth(),

            ok:
                true,

            check_ms:
                started
                    .elapsed()
                    .as_secs_f64()
                * 1000.0,
        };

    println!(
        "{}",
        serde_json::to_string(
            &output
        ).unwrap()
    );
}


#[derive(Deserialize)]
struct VerifyRequest {
    proof:
        String,

    root:
        String,

    nullifier:
        String,

    amount:
        String,

    // A25 — ví nhận, public input thứ 4.
    recipient:
        String,
}


#[derive(Serialize)]
pub struct VerifyOutput {
    pub verified:
        bool,

    pub setup_ms:
        f64,

    pub verify_ms:
        f64,
}


/*
 * MODE: VERIFY
 *
 * Xác thực proof bằng native Halo2, tách hẳn
 * khỏi bước tạo proof. verify_ms chỉ đo đúng
 * lời gọi verify_proof; chi phí nạp params và
 * dựng vk nằm ở setup_ms.
 */
pub fn verify_proof_only() {
    let mut input =
        String::new();

    io::stdin()
        .read_to_string(
            &mut input
        )
        .unwrap();

    if input
        .trim()
        .is_empty()
    {
        panic!(
            "Rust verify mode received empty stdin"
        );
    }

    let request:
        VerifyRequest =
        serde_json::from_str(
            &input
        )
        .unwrap_or_else(
            |error| {
                panic!(
                    "Invalid verify JSON: {:?}",
                    error
                );
            }
        );

    let proof_hex =
        request
            .proof
            .strip_prefix("0x")
            .unwrap_or(
                &request.proof
            );

    let proof =
        hex::decode(
            proof_hex
        )
        .expect(
            "proof phải là chuỗi hex"
        );

    // Thứ tự phải khớp cột instance của
    // circuit: 0 = root, 1 = nullifier,
    // 2 = amount, 3 = recipient (A25).
    let public_inputs =
        vec![
            hex_to_fp(
                &request.root
            ),
            hex_to_fp(
                &request.nullifier
            ),
            hex_to_fp(
                &request.amount
            ),
            crate::transfer_address::recipient_to_fp(
                &request.recipient
            ),
        ];

    let setup_started =
        Instant::now();

    let params =
        load_or_create_params();

    let vk =
        keygen_vk(
            &params,
            &shape_only_circuit(),
        )
        .expect(
            "keygen_vk thất bại"
        );

    let setup_ms =
        setup_started
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    let verify_started =
        Instant::now();

    let mut transcript =
        Blake2bRead::<
            &[u8],
            vesta::Affine,
            Challenge255<vesta::Affine>,
        >::init(
            &proof[..]
        );

    let strategy =
        SingleVerifier::new(
            &params
        );

    let result =
        verify_proof(
            &params,
            &vk,
            strategy,
            &[&[
                &public_inputs[..]
            ]],
            &mut transcript,
        );

    let verify_ms =
        verify_started
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    match result {
        Ok(()) => {
            let output =
                VerifyOutput {
                    verified:
                        true,

                    setup_ms,

                    verify_ms,
                };

            println!(
                "{}",
                serde_json::to_string(
                    &output
                ).unwrap()
            );

            eprintln!(
                "\n========================"
            );

            eprintln!(
                "OFF-CHAIN VERIFICATION OK"
            );

            eprintln!(
                "========================"
            );

            eprintln!(
                "setup_ms  = {:.3}",
                setup_ms
            );

            eprintln!(
                "verify_ms = {:.3}",
                verify_ms
            );
        }

        Err(error) => {
            eprintln!(
                "\n========================"
            );

            eprintln!(
                "OFF-CHAIN VERIFICATION FAILED"
            );

            eprintln!(
                "========================"
            );

            eprintln!(
                "verification error = {:?}",
                error
            );

            panic!(
                "Proof was rejected by the native Halo2 verifier"
            );
        }
    }
}


#[derive(Serialize, Deserialize)]
pub struct ProofOutput {

    pub proof: String,

    pub root: String,

    pub nullifier: String,

    pub amount: String,

    /*
     * A25 — ví nhận, public input thứ 4. Word 32 byte đệm trái —
     * trùng cách Solidity mã hoá `address`.
     */
    pub recipient: String,

    /*
     * Ba mốc thời gian tách rời, phục vụ thực nghiệm
     * định lượng §2.1.1 (C-1).
     *
     * tree_and_witness_ms — dựng Merkle tree + witness
     * setup_ms            — nạp params + keygen vk/pk;
     *                       chi phí MỘT LẦN cho cả hệ,
     *                       phải trừ ra khi báo cáo thời
     *                       gian sinh proof
     * prove_ms            — đúng lời gọi create_proof
     *
     * Nhánh on-chain keygen một lần ngoài vòng lặp; ở
     * đây mỗi proof là một tiến trình riêng nên setup
     * lặp lại. Tách ba mốc để hai nhánh so được với nhau.
     */
    pub tree_and_witness_ms: f64,

    pub setup_ms: f64,

    pub prove_ms: f64,

    pub total_ms: f64,
}



#[derive(Serialize, Deserialize)]
// pub struct RootOutput {
//     pub root: String,

//     pub nullifier: String,

//     pub amount: String,
// }
pub struct RootOutput {
    pub root:
        String,

    pub leaf_count:
        usize,

    /*
     * K10 — 03/09/2026: tra ve luon cac tang nut cua cay
     * de backend luu vao collection `merkleNodes`. Nho do
     * buoc rut chi doc `depth` nut thay vi dung lai cay.
     *
     * nodes[level][index]; nodes[depth][0] chinh la root.
     * `zeros[level]` la goc cay con RONG cua tang do, can
     * cho o trong — phai khop quy uoc trong `get_path`.
     */
    pub nodes:
        Vec<Vec<String>>,

    pub zeros:
        Vec<String>,
}



pub struct ProofData {

    pub params: halo2_proofs::poly::commitment::Params<vesta::Affine>,

    pub vk: halo2_proofs::plonk::VerifyingKey<vesta::Affine>,

    pub proof: Vec<u8>,

    pub public_inputs: Vec<Vec<pallas::Base>>,
}



pub fn compute_commitment_only() {
    let note =
        build_note_only();

    let commitment_value =
        commitment(
            note.student_id,
            note.scholarship_amount,
            note.rho,
        );

    let output =
        CommitmentOutput {
            commitment:
                fp_to_hex(
                    commitment_value
                ),
        };

    // stdout chỉ chứa JSON
    // để TypeScript parse.
    println!(
        "{}",
        serde_json::to_string(
            &output
        ).unwrap()
    );

    eprintln!(
        "COMMITMENT COMPUTED"
    );
}


// =========================
// COMPUTE NULLIFIER ONLY
// NO PROOF IS CREATED HERE
//
// Backend dùng mode này để tính
// expected_nullifier độc lập với
// output của mode prove.
// =========================

pub fn compute_nullifier_only() {
    let note =
        build_note_only();

    let nullifier_value =
        nullifier(
            &note
        );

    let output =
        NullifierOutput {
            nullifier:
                fp_to_hex(
                    nullifier_value
                ),
        };

    // stdout chỉ chứa JSON
    // để TypeScript parse.
    println!(
        "{}",
        serde_json::to_string(
            &output
        ).unwrap()
    );

    eprintln!(
        "NULLIFIER COMPUTED - NO PROOF CREATED"
    );
}


#[derive(Deserialize)]
struct RootRequest {
    commitments:
        Vec<String>,
}



// =========================
// COMPUTE ROOT ONLY
// NO PROOF IS CREATED HERE
// =========================



// pub fn compute_root_only() {
//     let inputs =
//         build_inputs();

//     let output =
//         RootOutput {
//             root:
//                 fp_to_hex(
//                     inputs.root
//                 ),

//             nullifier:
//                 fp_to_hex(
//                     inputs.nullifier
//                 ),

//             amount:
//                 fp_to_hex(
//                     inputs
//                         .note
//                         .scholarship_amount
//                 ),
//         };

//     // stdout chỉ chứa JSON
//     // để TypeScript parse.
//     println!(
//         "{}",
//         serde_json::to_string(
//             &output
//         ).unwrap()
//     );

//     eprintln!(
//         "\n========================"
//     );

//     eprintln!(
//         "ROOT COMPUTED - NO PROOF CREATED"
//     );

//     eprintln!(
//         "========================"
//     );

//     eprintln!(
//         "root = {}",
//         output.root
//     );
// }


pub fn compute_root_only() {
    let mut input =
        String::new();

    io::stdin()
        .read_to_string(
            &mut input
        )
        .unwrap();

    if input
        .trim()
        .is_empty()
    {
        panic!(
            "Rust root mode received empty stdin"
        );
    }

    let request:
        RootRequest =
        serde_json::from_str(
            &input
        )
        .unwrap_or_else(
            |error| {
                panic!(
                    "Invalid root JSON: {:?}",
                    error
                );
            }
        );

    if request
        .commitments
        .is_empty()
    {
        panic!(
            "Cannot build root from empty commitments"
        );
    }

    let maximum_leaves =
        1usize
        <<
        merkle_depth();

    if request
        .commitments
        .len()
        >
        maximum_leaves
    {
        panic!(
            "Merkle depth {} supports at most {} leaves",
            merkle_depth(),
            maximum_leaves
        );
    }

    let mut tree =
        MerkleTree::new(
            merkle_depth()
        );

    for commitment_hex
        in &request.commitments
    {
        tree.insert(
            hex_to_fp(
                commitment_hex
            )
        );
    }

    let root =
        tree.root();

    let output =
        RootOutput {
            root:
                fp_to_hex(
                    root
                ),

            leaf_count:
                request
                    .commitments
                    .len(),

            nodes:
                tree
                    .nodes
                    .iter()
                    .map(
                        |tang| {
                            tang
                                .iter()
                                .map(
                                    |gia_tri| {
                                        fp_to_hex(
                                            *gia_tri
                                        )
                                    }
                                )
                                .collect()
                        }
                    )
                    .collect(),

            zeros:
                tree
                    .zeros
                    .iter()
                    .map(
                        |gia_tri| {
                            fp_to_hex(
                                *gia_tri
                            )
                        }
                    )
                    .collect(),
        };

    println!(
        "{}",
        serde_json::to_string(
            &output
        ).unwrap()
    );

    eprintln!(
        "ROOT COMPUTED FROM MONGODB COMMITMENTS"
    );

    eprintln!(
        "leaf count = {}",
        output.leaf_count
    );

    eprintln!(
        "root = {}",
        output.root
    );
}



pub fn generate_real_proof() -> ProofData {

    // Mốc 1: dựng Merkle tree + witness.
    // Tách khỏi setup và khỏi create_proof để con số
    // so được với nhánh on-chain, nơi keygen chạy một
    // lần ngoài vòng lặp còn ở đây mỗi proof là một
    // tiến trình riêng.
    let started_tree =
        Instant::now();

    let inputs = build_inputs();

    let circuit = MyCircuit {

        student_id: Value::known(
            inputs.note.student_id
            
        ),

        scholarship_amount: Value::known(
            inputs.note.scholarship_amount
        ),

        rho: Value::known(
            inputs.note.rho
        ),

        recipient: Value::known(
            inputs.recipient
        ),

        path_siblings: inputs
            .siblings
            .iter()
            .map(|x| Value::known(*x))
            .collect(),

        path_directions: inputs.directions,

        // root: Value::known(
        //     inputs.root
        // ),

        // nullifier: Value::known(
        //     inputs.nullifier
        // ),
        // address: Value::known(
        //     inputs.address
        // )
    };

    let tree_and_witness_ms =
        started_tree
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    // Mốc 2: nạp params + keygen vk/pk.
    // Đây là chi phí một lần cho cả hệ, không phải
    // chi phí mỗi proof — phải để riêng thì con số
    // proof generation time mới đọc đúng.
    let started_setup =
        Instant::now();

    // =========================
    // PARAMS
    //
    // Nạp lại từ shared/params.bin nếu có.
    // Trước A2, dòng này là Params::new(k)
    // chạy lại mỗi lần và bị tính vào thời
    // gian sinh proof.
    // =========================

    let params: Params<vesta::Affine> =
        load_or_create_params();

    

    // =========================
    // VK
    // =========================

    let vk = keygen_vk(
        &params,
        &circuit,
    ).unwrap();
    

    let vk_bytes = format!("{:?}", vk);

    fs::write(
        "../shared/vk.txt",
        vk_bytes
    ).unwrap();



    // =========================
    // PK
    // =========================

    let pk = keygen_pk(
        &params,
        vk.clone(),
        &circuit,
    ).unwrap();

    let setup_ms =
        started_setup
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    // =========================
    // PUBLIC INPUTS
    // =========================

    let public_inputs = vec![
        vec![
            inputs.root,
            inputs.nullifier,
            inputs.note.scholarship_amount,
            // A25 — hàng 3 của cột instance.
            inputs.recipient,
        ]
    ];


    eprintln!(
        "Public root = {}",
        fp_to_hex(inputs.root)
    );

    eprintln!(
        "Public nullifier = {}",
        fp_to_hex(inputs.nullifier)
    );

    eprintln!(
        "Public amount = {}",
        fp_to_hex(
            inputs.note.scholarship_amount
        )
    );

    eprintln!(
        "Public recipient = {}",
        fp_to_hex(inputs.recipient)
    );

    // =========================
    // TRANSCRIPT
    // =========================


    let mut transcript = Blake2bWrite::<
        Vec<u8>,
        vesta::Affine,
        Challenge255<vesta::Affine>,
    >::init(vec![]);



    // =========================
    // CHECK CONSTRAINT
    // =========================

    // let mock_prover = MockProver::run(
    //     k,
    //     &circuit,
    //     vec![vec![
    //         inputs.root,
    //         inputs.nullifier,
    //     ]]
    // ).unwrap();

    // mock_prover.assert_satisfied();





    // =========================
    // CREATE PROOF
    // =========================

    // Mốc 3: chỉ đúng lời gọi create_proof.
    // Không gồm dựng witness, không gồm keygen.
    let started_prove =
        Instant::now();

    create_proof(
        &params,
        &pk,
        &[circuit],
        &[&[
            &public_inputs[0]
        ]],
        OsRng,
        &mut transcript,
    ).unwrap();

    let proof = transcript.finalize();

    let prove_ms =
        started_prove
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    eprintln!("\n========================");
    eprintln!("CREATE PROOF COMPLETED");
    eprintln!("========================");
    
    let proof_hex = hex::encode(&proof);
    eprintln!("proof bytes len = {}", proof.len());
    eprintln!(
        "proof hex = 0x{}",
        proof_hex
    );

    /*
     * KHÔNG verify ở đây.
     *
     * Trước đây có một lần verify nội bộ ngay sau
     * create_proof, dùng CHÍNH public inputs mà prover
     * vừa tự tính — nên nó tự chấm bài của chính nó và
     * gần như luôn thành công.
     *
     * Đã gỡ vì:
     *   - về khả năng chặn, nó là tập con thực sự của
     *     mode `verify` (mode đó nạp public inputs từ
     *     smart contract + backend, bắt được cả trường
     *     hợp ba số bị đổi);
     *   - nó cộng ~7 ms vào thời gian `prove`, làm bẩn
     *     con số proof generation time của §2.1.1.
     *
     * Cần chẩn đoán thì chạy lại được bất cứ lúc nào:
     *   Get-Content ../shared/proof.json | prover.exe verify
     * proof.json lưu sẵn ba số của prover, nên lệnh đó
     * chính là lần verify nội bộ cũ.
     *
     * Xem code/VERIFY_MECHANISM.md.
     */

    let output = ProofOutput {

        proof: hex::encode(&proof),

        root: fp_to_hex(inputs.root),

        nullifier: fp_to_hex(inputs.nullifier),

        amount: fp_to_hex(inputs.note.scholarship_amount),

        recipient: fp_to_hex(inputs.recipient),

        tree_and_witness_ms,

        setup_ms,

        prove_ms,

        total_ms:
            tree_and_witness_ms
            + setup_ms
            + prove_ms,

    };

    fs::write(
        "../shared/proof.json",
        serde_json::to_string_pretty(&output).unwrap()
    ).unwrap();

    fs::write(
        "../shared/proof.bin",
        &proof
    ).unwrap();

    println!(
        "{}",
        serde_json::to_string(&output).unwrap()
    );





    eprintln!("\n========================");
    eprintln!("REAL PROOF");
    eprintln!("========================");

    eprintln!(
        "proof hex = 0x{}",
        hex::encode(&proof)
    );

    eprintln!(
        "proof bytes len = {}",
        proof.len()
    );



    ProofData {
        params,
        vk,
        proof,
        public_inputs,
    }



    
}


/*
 * =====================================================================
 * LAP20 (17/09/2026) — MODE `prove-batch`: MOT TIEN TRINH CHO CA LUOT
 * =====================================================================
 *
 * Vi sao co mode nay. Bo do cua hai nhanh dang do o DIEU KIEN KHAC NHAU:
 * nhanh on-chain chay mot tien trinh cho ca luot (keygen mot lan, roi n proof
 * trong vong lap nong), con nhanh nay mo mot tien trinh MOI cho moi proof
 * (keygen lai moi lan). Vi vay hai cot `setup_ms` khong dat canh nhau duoc.
 * Mode nay lam cho nhanh off-chain do GIONG nhanh on-chain.
 *
 * 🔴 Day KHONG phai luong that. Luong rut tien that cua CA HAI nhanh van mo
 * mot tien trinh moi cho moi luot rut, nen deu sinh lai khoa. Khong cai dat
 * nao luu proving key giua hai luot rut. Lo do "nguoi" (mode `prove` + mode
 * `verify`, moi proof mot tien trinh) van giu nguyen va chinh la bang chung
 * cho chi phi luong that.
 *
 * Mode `prove` va mode `verify` cu KHONG bi dung toi mot dong nao.
 *
 * Vao  (stdin): mot MANG JSON cac sinh vien, dung schema ma mode `prove` doc.
 * Ra   (stdout): mot doi tuong JSON duy nhat:
 *   setup_ms      nap params + keygen_vk + keygen_pk, DUNG mot lan
 *   k             K cua mach
 *   merkle_depth  do sau dang dung
 *   proofs[]      moi sinh vien mot muc, xem BatchProofItem
 *
 * Ranh gioi dong ho giu DUNG nhu mode `prove` (D1):
 *   tree_and_witness_ms — dung witness, khong gom keygen
 *   prove_ms            — dung loi goi create_proof
 *   setup_ms            — nap params + keygen, DE RIENG, khong cong vao dau ca
 *
 * ⚠️ `verify_native_ms` o day la prover TU kiem proof vua sinh bang chinh
 * public input no vua tinh — dung y het nhanh on-chain lam trong
 * `bench-from-dataset`, nen hai con so so duoc voi nhau. No KHAC mode `verify`
 * doc lap (mode do nap public input tu contract + backend va bat duoc ca
 * truong hop ba so bi doi). Lo "nguoi" dung mode `verify` doc lap ay.
 *
 * Mode nay KHONG ghi ../shared/proof.json hay ../shared/vk.txt — nhung tep do
 * la dau ra cua luong thu cong, ghi de n lan la vo nghia va lam ban chung.
 */

#[derive(Serialize)]
pub struct BatchProofItem {
    pub student_index: usize,
    pub tree_and_witness_ms: f64,
    pub prove_ms: f64,
    pub verify_native_ms: f64,
    pub verified: bool,
    pub proof: String,
    pub root: String,
    pub nullifier: String,
    pub amount: String,
    pub recipient: String,
    pub proof_bytes: usize,
}

#[derive(Serialize)]
pub struct BatchOutput {
    pub setup_ms: f64,
    pub k: u32,
    pub merkle_depth: usize,
    pub so_sinh_vien: usize,
    pub proofs: Vec<BatchProofItem>,
}

pub fn run_prove_batch() {

    // -----------------------------------------------------------------
    // 1. Doc ca mang sinh vien — MOT lan
    // -----------------------------------------------------------------

    let mut raw = String::new();

    std::io::stdin()
        .read_to_string(&mut raw)
        .expect("khong doc duoc stdin");

    if raw.trim().is_empty() {
        panic!("prove-batch nhan stdin rong");
    }

    let students: Vec<StudentData> =
        serde_json::from_str(&raw)
            .unwrap_or_else(|error| {
                panic!(
                    "prove-batch can MOT MANG JSON cac sinh vien: {}",
                    error
                )
            });

    if students.is_empty() {
        panic!("prove-batch nhan mang rong");
    }

    let so_sinh_vien = students.len();

    eprintln!(
        "prove-batch: {} sinh vien, K = {}, merkle_depth = {}",
        so_sinh_vien,
        k(),
        merkle_depth()
    );

    // -----------------------------------------------------------------
    // 2. Nap params + keygen — DUNG MOT LAN cho ca luot
    //
    // Keygen chi phu thuoc SHAPE cua mach chu khong phu thuoc witness, nen
    // mot khoa dung duoc cho moi sinh vien. Day la cho khac duy nhat so voi
    // mode `prove`, va cung la muc dich cua mode nay.
    // -----------------------------------------------------------------

    let started_setup = Instant::now();

    let params: Params<vesta::Affine> =
        load_or_create_params();

    let shape = shape_only_circuit();

    let vk = keygen_vk(&params, &shape)
        .expect("keygen_vk that bai");

    let pk = keygen_pk(&params, vk.clone(), &shape)
        .expect("keygen_pk that bai");

    let setup_ms =
        started_setup
            .elapsed()
            .as_secs_f64()
        * 1000.0;

    eprintln!(
        "prove-batch: setup_ms = {:.1} ms (mot lan cho ca luot)",
        setup_ms
    );

    // -----------------------------------------------------------------
    // 3. Vong lap nong: witness -> create_proof -> verify
    // -----------------------------------------------------------------

    let mut ket_qua: Vec<BatchProofItem> =
        Vec::with_capacity(so_sinh_vien);

    for (student_index, student) in students.into_iter().enumerate() {

        // --- moc 1: dung witness ---
        let started_tree = Instant::now();

        let inputs = build_inputs_from(student);

        let circuit = MyCircuit {
            student_id:
                Value::known(inputs.note.student_id),
            scholarship_amount:
                Value::known(inputs.note.scholarship_amount),
            rho:
                Value::known(inputs.note.rho),
            recipient:
                Value::known(inputs.recipient),
            path_siblings:
                inputs
                    .siblings
                    .iter()
                    .map(|x| Value::known(*x))
                    .collect(),
            path_directions:
                inputs.directions.clone(),
        };

        let tree_and_witness_ms =
            started_tree
                .elapsed()
                .as_secs_f64()
            * 1000.0;

        let public_inputs = vec![
            inputs.root,
            inputs.nullifier,
            inputs.note.scholarship_amount,
            inputs.recipient,
        ];

        // --- moc 2: dung loi goi create_proof ---
        let mut transcript = Blake2bWrite::<
            Vec<u8>,
            vesta::Affine,
            Challenge255<vesta::Affine>,
        >::init(vec![]);

        let started_prove = Instant::now();

        create_proof(
            &params,
            &pk,
            &[circuit],
            &[&[&public_inputs[..]]],
            OsRng,
            &mut transcript,
        ).expect("create_proof that bai");

        let proof = transcript.finalize();

        let prove_ms =
            started_prove
                .elapsed()
                .as_secs_f64()
            * 1000.0;

        // --- moc 3: verify ngay tai cho, vk da nam san trong RAM ---
        let started_verify = Instant::now();

        let mut doc = Blake2bRead::<
            &[u8],
            vesta::Affine,
            Challenge255<vesta::Affine>,
        >::init(&proof[..]);

        let verified = verify_proof(
            &params,
            pk.get_vk(),
            SingleVerifier::new(&params),
            &[&[&public_inputs[..]]],
            &mut doc,
        ).is_ok();

        let verify_native_ms =
            started_verify
                .elapsed()
                .as_secs_f64()
            * 1000.0;

        assert!(
            verified,
            "proof vua sinh KHONG qua verify native (student_index = {})",
            student_index
        );

        ket_qua.push(BatchProofItem {
            student_index,
            tree_and_witness_ms,
            prove_ms,
            verify_native_ms,
            verified,
            proof: hex::encode(&proof),
            root: fp_to_hex(inputs.root),
            nullifier: fp_to_hex(inputs.nullifier),
            amount: fp_to_hex(inputs.note.scholarship_amount),
            recipient: fp_to_hex(inputs.recipient),
            proof_bytes: proof.len(),
        });
    }

    // -----------------------------------------------------------------
    // 4. Mot doi tuong JSON duy nhat tren stdout — dung quy uoc CLI cua repo
    // -----------------------------------------------------------------

    let output = BatchOutput {
        setup_ms,
        k: k(),
        merkle_depth: merkle_depth(),
        so_sinh_vien,
        proofs: ket_qua,
    };

    println!(
        "{}",
        serde_json::to_string_pretty(&output)
            .expect("khong serialize duoc ket qua prove-batch")
    );
}
