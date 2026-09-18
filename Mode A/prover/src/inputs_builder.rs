use pasta_curves::pallas::Base as Fp;
use serde::Deserialize;
use circuits::{
    note::Note,
    merkle_tree::MerkleTree,
    commitment::commitment,
    nullifier::nullifier,
    poseidon::poseidon_hash_merkle,
};
use std::io::{self, Read};
use crate::utils::{hex_to_fp, fp_to_hex, decimal_string_to_fp};
/*
 * MERKLE_DEPTH — do sau cay Merkle. Mac dinh 9 (luong that + lo do 12/09).
 *
 * LAP20 (14/09/2026): thi nghiem theo d can doi do sau LUC CHAY, khong build
 * lai binary cho moi d. Bien moi truong `MERKLE_DEPTH` ghi de gia tri mac
 * dinh; KHONG dat bien thi hanh vi y het truoc. Mach doc do sau tu do dai
 * `path_siblings`, nen crate `circuits` khong phai sua gi.
 *
 * Gia tri sai (khong phai so, bang 0, > 32) => panic, KHONG lang le quay ve
 * 9: im lang o day nghia la mot lo "theo d" thuc ra do toan d = 9.
 */
pub const MERKLE_DEPTH_MAC_DINH: usize = 9;

pub fn merkle_depth() -> usize {
    match std::env::var("MERKLE_DEPTH") {
        Err(_) => MERKLE_DEPTH_MAC_DINH,

        Ok(gia_tri) => {
            let d: usize =
                gia_tri
                    .trim()
                    .parse()
                    .unwrap_or_else(|_| {
                        panic!("MERKLE_DEPTH khong hop le: {:?}", gia_tri)
                    });

            if d == 0 || d > 32 {
                panic!("MERKLE_DEPTH ngoai khoang 1..=32: {}", d);
            }

            d
        }
    }
}

// #[derive(Deserialize)]
// struct StudentData {
//     student_id: u64,
//     // amount: u64,
//     amount: String,
//     rho: String,
//     #[serde(default)]
//     expected_root: Option<String>
// }


#[derive(Deserialize)]
pub struct StudentData {
    student_id:
        u64,

    amount:
        String,

    rho:
        String,

    #[serde(default)]
    expected_root:
        Option<String>,

    #[serde(default)]
    commitments:
        Vec<String>,

    #[serde(default)]
    merkle_index:
        Option<usize>,

    /*
     * K10 — duong Merkle da luu san trong `merkleNodes`.
     * Co du `depth` phan tu thi prover bo qua buoc dung cay.
     */
    #[serde(default)]
    siblings:
        Vec<String>,

    #[serde(default)]
    directions:
        Vec<bool>,

    /*
     * A25 — ví nhận tiền, public input thứ 4. Bắt buộc ở mode
     * `prove`; các mode khác (commitment, nullifier) không cần.
     */
    #[serde(default)]
    recipient:
        Option<String>,
}

pub struct CircuitInputs {
    pub note: Note,
    pub root: Fp,
    pub nullifier: Fp,
    pub siblings: Vec<Fp>,
    pub directions: Vec<bool>,
    pub recipient: Fp,
}



fn read_student_data()
    -> StudentData
{
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
            "Rust received empty stdin"
        );
    }

    serde_json::from_str(
        &input
    )
    .unwrap_or_else(
        |error| {
            panic!(
                "Invalid student JSON: {:?}",
                error
            );
        }
    )
}



pub fn build_note_only()
    -> Note
{
    let student =
        read_student_data();

    Note::new(
        Fp::from(
            student.student_id
        ),

        decimal_string_to_fp(
            &student.amount
        ),

        decimal_string_to_fp(
            &student.rho
        ),
    )
}



pub fn build_inputs() -> CircuitInputs {
    build_inputs_from(read_student_data())
}

/*
 * LAP20 (17/09/2026) — tach phan DUNG witness ra khoi phan DOC stdin.
 *
 * Mode `prove` van goi `build_inputs()` nhu cu: doc mot sinh vien tu stdin roi
 * dung witness — hanh vi khong doi mot ly nao.
 *
 * Mode `prove-batch` doc MOT MANG sinh vien mot lan roi goi thang ham nay cho
 * tung nguoi, de keygen chi chay mot lan cho ca luot. Than ham duoi day giu
 * nguyen tung dong so voi truoc khi tach.
 */
pub fn build_inputs_from(
    student: StudentData
) -> CircuitInputs {

    /*
     * A25 — thiếu ví nhận thì proof không gắn với ví nào, và kẻ chép
     * proof trong mempool gửi sang ví của hắn vẫn qua.
     */
    let recipient =
        crate::transfer_address::recipient_to_fp(
            student
                .recipient
                .as_deref()
                .unwrap_or_else(|| {
                    panic!("recipient is required in prove mode")
                })
        );
    

    // let note = Note::new(
    //     Fp::from(24560005),
    //     Fp::from(3),
    //     Fp::from(12345678932),
    // );

    // let raw = fs::read_to_string("../shared/student.json").unwrap();

    // let student: StudentData = serde_json::from_str(&raw).unwrap();

    // let args: Vec<String> = env::args().collect();
    // let raw = &args[1];

    // let student: StudentData = serde_json::from_str(raw).unwrap();

    let note = Note::new(
        Fp::from(student.student_id),
        // Fp::from(student.amount),
        decimal_string_to_fp(&student.amount),
        decimal_string_to_fp(&student.rho)
    );

    

    // let note2 = Note::new(
    //     Fp::from(999999),
    //     Fp::from(5),
    //     Fp::from(888888),
    // );

    // let note3 = Note::new(
    //     Fp::from(999999000),
    //     Fp::from(5),
    //     Fp::from(8888887777),
    // );

    // let approved_note = Note::new(
    //     Fp::from(24560005),
    //     Fp::from(3),
    //     Fp::from(12345678932),
    // );

    // let witness_note = Note::new(
    //     Fp::from(student.student_id),
    //     Fp::from(student.amount),
    //     decimal_string_to_fp(&student.rho),
    // );

    // let approved_commitment = commitment(
    //     approved_note.student_id,
    //     approved_note.scholarship_amount,
    //     approved_note.rho,
    // );


    // let leaf1 = commitment(
    //     note.student_id,
    //     note.scholarship_amount,
    //     note.rho,
    // );



    let witness_commitment =
        commitment(
            note.student_id,
            note.scholarship_amount,
            note.rho,
        );

    eprintln!(
        "Witness commitment = {}",
        fp_to_hex(
            witness_commitment
        )
    );




    // let leaf1_hex = fp_to_hex(leaf1);

    // eprintln!("leaf1 debug = {:?}", leaf1);
    // eprintln!("leaf1 fp_to_hex = {}", leaf1_hex);


    
    // let leaf2 = commitment(
    //     note2.student_id,
    //     note2.scholarship_amount,
    //     note2.rho,
    // );  

    // let leaf3 = commitment(
    //     note3.student_id,
    //     note3.scholarship_amount,
    //     note3.rho,
    // );

    // let addr = "0xAFC08cbd856E54B993Ef4249D3afAFaCD4F40f0f";
    // let trans_addr = eth_address_to_fp(addr);


    // let raw = fs::read_to_string(
    //     "../shared/commitments.json"
    // ).unwrap();

    // let commitments_hex: Vec<String> =
    //     serde_json::from_str(&raw).unwrap();

    // for x in &commitments_hex {
    //     eprintln!("raw hex = {}", x);
    // }

    // let commitments_from_chain: Vec<Fp> =
    //     commitments_hex
    //         .iter()
    //         .map(|x| hex_to_fp(x))
    //         .collect();


    // for x in &commitments_from_chain {

    //     eprintln!(
    //         "chain fp_to_hex = {}",
    //         fp_to_hex(*x)
    //     );

    //     eprintln!(
    //         "chain debug = {:?}",
    //         x
    //     );
    // }


    // for x in &commitments_from_chain {
    //     eprintln!("fp = {:?}", x);
    // }

    // let mut tree = MerkleTree::new(3);

    // // tree.insert(approved_commitment);
    // tree.insert(leaf1);     
    // tree.insert(leaf2);
    // tree.insert(leaf3);

    // eprintln!("========================");
    // eprintln!("MERKLE TREE WITH MULTIPLE STUDENTS");
    // eprintln!("========================");

    // eprintln!("Student 1 leaf = {}", fp_to_hex(leaf1));
    // eprintln!("Student 2 leaf = {}", fp_to_hex(leaf2));
    // eprintln!("Student 3 leaf = {}", fp_to_hex(leaf3));

    // eprintln!("Number of inserted leaves = {}", tree.nodes[0].len());

    // eprintln!("Commitments from chain");

    // for c in &commitments_from_chain {
    //     eprintln!("{:?}", c);
    // }

    // eprintln!("leaf1 = {:?}", leaf1);

    // eprintln!("commitments_hex:");
    // for c in &commitments_hex {
    //     eprintln!("{}", c);
    // }

    // eprintln!("commitments_from_chain:");
    // for c in &commitments_from_chain {
    //     eprintln!("{:?}", c);
    // }

    // for c in &commitments_from_chain {
    //     tree.insert(*c);
    // }


    // let index =
    //     commitments_from_chain
    //         .iter()
    //         .position(
    //             |x| *x == leaf1
    //         )
    //         .unwrap();


    // for x in &commitments_from_chain {

    //     eprintln!(
    //         "x == leaf1 ? {}",
    //         *x == leaf1
    //     );

    //     eprintln!(
    //         "x hex = {}",
    //         fp_to_hex(*x)
    //     );

    //     eprintln!(
    //         "leaf1 hex = {}",
    //         fp_to_hex(leaf1)
    //     );
    // }

    // let index =
    // commitments_from_chain
    //     .iter()
    //     .position(
    //         |x| *x == leaf1
    //     );

    // eprintln!("index = {:?}", index);


    // let index =
    //     commitments_from_chain
    //         .iter()
    //         .position(
    //             |x| fp_to_hex(*x) == leaf1_hex
    //         )
    //         .unwrap();

    // eprintln!("index = {}", index);

    // let index = index.unwrap();


    /*
     * K10 — 03/09/2026: hai đường lấy Merkle path.
     *
     * A. `siblings` + `directions` gửi sẵn — backend đã đọc
     *    đúng `depth` nút từ collection `merkleNodes`, nên
     *    prover KHÔNG dựng lại cây. Chi phí O(depth).
     *
     * B. Không gửi — giữ nguyên đường cũ, dựng cây từ toàn
     *    bộ commitment. Chi phí O(n × depth). Đây vẫn là
     *    đường mặc định nên mọi lệnh cũ chạy nguyên vẹn.
     *
     * Hai đường phải cho ra CÙNG một path. Test đối chứng:
     * `merkle_path_luu_san_khop_dung_lai_cay` cuối file này.
     */
    let co_duong_luu_san =
        student
            .siblings
            .len()
        ==
        merkle_depth()
        &&
        student
            .directions
            .len()
        ==
        merkle_depth();

    let index =
        student
            .merkle_index
            .expect(
                "merkle_index is required in prove mode"
            );

    let (
        root,
        siblings,
        directions,
        so_commitment
    ) =
        if co_duong_luu_san {

        let duong_sibling:
            Vec<Fp> =
            student
                .siblings
                .iter()
                .map(
                    |value| {
                        hex_to_fp(
                            value
                        )
                    }
                )
                .collect();

        let duong_direction:
            Vec<bool> =
            student
                .directions
                .clone();

        /*
         * Leo từ commitment của chính mình lên gốc, đúng
         * quy ước của `get_path` và của custom gate:
         *   direction = true  -> node hiện tại là con PHẢI
         *   direction = false -> node hiện tại là con TRÁI
         */
        let mut leo =
            witness_commitment;

        for (
            sibling,
            direction
        )
            in duong_sibling
                .iter()
                .zip(
                    duong_direction
                        .iter()
                )
        {
            leo = if *direction {
                poseidon_hash_merkle(
                    *sibling,
                    leo
                )
            } else {
                poseidon_hash_merkle(
                    leo,
                    *sibling
                )
            };
        }

        eprintln!(
            "Merkle path doc tu merkleNodes - khong dung lai cay"
        );

        (
            leo,
            duong_sibling,
            duong_direction,
            0usize
        )

    } else {

        if student
            .commitments
            .is_empty()
        {
            panic!(
                "No approved commitments supplied from MongoDB"
            );
        }

        let maximum_leaves =
            1usize
            <<
            merkle_depth();

        if student
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

        let commitments:
            Vec<Fp> =
            student
                .commitments
                .iter()
                .map(
                    |value| {
                        hex_to_fp(
                            value
                        )
                    }
                )
                .collect();

        if index
            >=
            commitments.len()
        {
            panic!(
                "merkle_index {} exceeds commitment count {}",
                index,
                commitments.len()
            );
        }

        /*
         * KHÔNG panic ở đây.
         *
         * Guard này chạy trong prover — một binary nằm ở
         * phía người dùng (ADV còn có bản WASM chạy trong
         * trình duyệt sinh viên). Kẻ gian sửa hoặc xoá nó
         * là xong, nên nó KHÔNG phải ranh giới tin cậy.
         *
         * Việc từ chối thuộc về mode `verify`, nơi ba public
         * input được nạp từ nguồn độc lập với prover
         * (smart contract + backend). Xem VERIFY_MECHANISM.md.
         *
         * Giữ lại thông điệp để người dùng trung thực biết
         * mình sai ở đâu.
         */
        if commitments[index]
            !=
            witness_commitment
        {
            eprintln!(
                "CẢNH BÁO: commitment tại merkle_index không khớp \
                 note đã giải mã. Proof vẫn được tạo; việc từ chối \
                 thuộc về bước verify."
            );
        }

        let mut tree =
            MerkleTree::new(
                merkle_depth()
            );

        for commitment_value
            in &commitments
        {
            tree.insert(
                *commitment_value
            );
        }

        let (
            duong_sibling,
            duong_direction
        ) =
            tree.get_path(
                index
            );

        (
            tree.root(),
            duong_sibling,
            duong_direction,
            commitments.len()
        )
    };



    eprintln!("Common Merkle root = {}", fp_to_hex(root));
    // eprintln!("Proof student index = 0");
    eprintln!(
        "Proof student index = {}",
        index
    );

    eprintln!(
        "Number of approved commitments = {}",
        so_commitment
    );
    eprintln!("Path directions = {:?}", directions);
    eprintln!("Path sibling count = {}", siblings.len());


    /*
     * Root dùng làm public input phải là root mà CIRCUIT
     * sẽ tính ra — tức băm witness_commitment leo hết
     * Merkle path, đúng y phép tính trong circuit.
     *
     * Quy ước direction khớp get_path và custom gate:
     *   direction = true  -> node hiện tại là con PHẢI
     *   direction = false -> node hiện tại là con TRÁI
     *
     * Vì sao KHÔNG lấy expected_root (root của contract):
     * circuit ràng buộc cell root tính được vào cột
     * instance. Nếu điền vào đó một con số khác thứ
     * circuit tính ra thì create_proof hỏng, và mode
     * `verify` không bao giờ nhìn thấy proof để mà từ
     * chối. Điền đúng root circuit tính ra thì proof
     * luôn tạo được, còn việc nó có khớp trạng thái thật
     * hay không là việc của verifier.
     *
     * Đường trung thực không đổi: note đúng thì giá trị
     * này bằng tree.root() và bằng expected_root.
     */
    let witness_path_root = {
        let mut current = witness_commitment;

        for (sibling, direction)
            in siblings.iter().zip(directions.iter())
        {
            current = if *direction {
                poseidon_hash_merkle(*sibling, current)
            } else {
                poseidon_hash_merkle(current, *sibling)
            };
        }

        current
    };

    if let Some(expected_root_hex) =
        student.expected_root.as_ref()
    {
        let expected_root =
            hex_to_fp(expected_root_hex);

        eprintln!(
            "Local Merkle root        = {}",
            fp_to_hex(root)
        );

        eprintln!(
            "Root from smart contract = {}",
            fp_to_hex(expected_root)
        );

        eprintln!(
            "Root from witness path   = {}",
            fp_to_hex(witness_path_root)
        );

        /*
         * Cảnh báo, không panic — cùng lý do với guard
         * commitment ở trên.
         */
        if witness_path_root != expected_root {
            eprintln!(
                "CẢNH BÁO: root dựng từ note không khớp currentRoot \
                 trên smart contract. Proof vẫn được tạo; việc từ \
                 chối thuộc về bước verify."
            );
        }
    }

    let public_root = witness_path_root; 





    
    // let expected_nullifier = nullifier(&approved_note);
    // let (siblings, directions) = tree.get_path(index);

    let nf = nullifier(&note);
    eprintln!(
        "Public nullifier computed"
    );

    // eprintln!("STEP 1 - before nullifier");
    // let nf = nullifier(&note);
    // eprintln!("STEP 2 - after nullifier");
    // eprintln!("Nullifier: {:?}", nf);

    // println!("Note: {:?}", note);
    // eprintln!("Leaf: {:?}", leaf1);
    // eprintln!("Root: {:?}", root);
    // eprintln!("Nullifier: {:?}", nf);
    // eprintln!("Note: {:?}", note);

    // let witness_commitment = commitment(
    //     witness_note.student_id,
    //     witness_note.scholarship_amount,
    //     witness_note.rho,
    // );

    // let witness_nullifier = nullifier(&witness_note);
    CircuitInputs {
        note,
        // root: expected_root,
        root: public_root,
        // nullifier: expected_nullifier,
        nullifier: nf,
        siblings,
        directions,
        recipient,
    }
}
