use std::io::{self, Read};

use circuits::{
    circuit::{NoteNative, ScholarshipCircuit},
    merkle_tree::{MerkleTree, MerkleWitness},
};
use ff_ce::hex;
use halo2_base::halo2_proofs::halo2curves::{
    bn256::Fr,
    ff::PrimeField,
};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;

pub const MERKLE_DEPTH: usize = 9;

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum DecimalInput {
    Number(u64),
    String(String),
}

#[derive(Deserialize)]
struct NoteRequest {
    student_id: u64,
    amount: DecimalInput,
    rho: String,
    #[serde(default)]
    expected_root: Option<String>,
    #[serde(default)]
    commitments: Vec<String>,
    #[serde(default)]
    merkle_index: Option<usize>,
    /*
     * K10 — duong Merkle da luu san trong `merkleNodes`.
     * Du `MERKLE_DEPTH` phan tu thi prover bo qua buoc dung cay.
     */
    #[serde(default)]
    siblings: Vec<String>,
    #[serde(default)]
    directions: Vec<bool>,
    /*
     * A25 — vi nhan tien, public input thu 4. Bat buoc o mode `prove`.
     */
    #[serde(default)]
    recipient: Option<String>,
}

#[derive(Deserialize)]
struct RootRequest {
    commitments: Vec<String>,
}

fn read_stdin() -> String {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .expect("Unable to read prover stdin");

    if input.trim().is_empty() {
        panic!("Prover received empty stdin");
    }

    input
}

fn decimal_string_to_fr(value: &str) -> Fr {
    if value.is_empty() {
        panic!("Decimal field must not be empty");
    }

    value.bytes().fold(Fr::from(0), |accumulator, byte| {
        if !byte.is_ascii_digit() {
            panic!("Expected an unsigned decimal string");
        }

        accumulator * Fr::from(10) + Fr::from((byte - b'0') as u64)
    })
}

fn decimal_input_to_fr(value: &DecimalInput) -> Fr {
    match value {
        DecimalInput::Number(number) => Fr::from(*number),
        DecimalInput::String(string) => decimal_string_to_fr(string),
    }
}

pub fn fr_to_bytes32_hex(value: Fr) -> String {
    let mut bytes = value.to_repr().as_ref().to_vec();
    bytes.reverse();
    format!("0x{}", hex::encode(bytes))
}

/*
 * A26 (2026-09-12) — `rho` duoc LAY MAU O RUST, trong truong.
 *
 * Truoc day Node sinh `rho`: ONC `crypto.randomBytes(31)`, ADV
 * `crypto.randomBytes(32)` — hai nhanh lech nhau. Ban 31 byte khong
 * bao gio vuot modulus nhung vut di 7-8 bit entropy de ne no; ban 32
 * byte thi ~81 % gia tri >= r nen bi thu gon am tham.
 *
 * Cach dung: LAY MAU BAC BO. Rut 32 byte tu OsRng, nhan neu < r
 * (`from_repr` tra Some), khong thi rut lai. Deu tuyet doi tren
 * [0, r), khong lech, khong mat entropy.
 */
pub fn random_fr() -> Fr {
    loop {
        let mut bytes = [0u8; 32];

        OsRng.fill_bytes(&mut bytes);

        let mut repr = <Fr as PrimeField>::Repr::default();
        repr.as_mut().copy_from_slice(&bytes);

        if let Some(value) = Option::<Fr>::from(Fr::from_repr(repr)) {
            return value;
        }
    }
}

/*
 * Chi in `rho` duoi dang word 32 byte. Node doi sang chuoi thap phan
 * de giu nguyen dinh dang note — do la DINH DANG, khong phai mat ma.
 */
pub fn generate_rho_only() {
    println!(
        "{}",
        serde_json::json!({
            "rho": fr_to_bytes32_hex(random_fr())
        })
    );
}

fn bytes32_hex_to_fr(value: &str) -> Fr {
    let raw = value.strip_prefix("0x").unwrap_or(value);
    if raw.len() != 64 {
        panic!("Expected a bytes32 hex value");
    }

    let mut bytes = hex::decode(raw).expect("Invalid bytes32 hex");
    bytes.reverse();

    let mut repr = <Fr as PrimeField>::Repr::default();
    repr.as_mut().copy_from_slice(&bytes);
    Option::<Fr>::from(Fr::from_repr(repr))
        .expect("bytes32 value is not a canonical BN254 scalar")
}

/*
 * A25 — vi nhan tien -> phan tu truong.
 *
 * Nhan dia chi 20 byte HOAC word 32 byte co 12 byte dau bang 0 — word la
 * dang prover xuat ra va la cach Solidity ma hoa `address`. Cung quy uoc
 * voi `recipient_to_fp` cua nhanh off-chain: gia tri la so nguyen
 * big-endian cua dia chi, nen word 32 byte trung khit o hai nhanh.
 */
pub fn recipient_to_fr(value: &str) -> Fr {
    let raw = value.strip_prefix("0x").unwrap_or(value);
    if !raw.chars().all(|c| c.is_ascii_hexdigit()) {
        panic!("recipient must be hex: {}", value);
    }
    let bytes = hex::decode(raw).expect("Invalid recipient hex");
    let address: Vec<u8> = match bytes.len() {
        20 => bytes,
        32 => {
            if bytes[..12].iter().any(|b| *b != 0) {
                panic!("recipient word has non-zero high bytes — not an address: {}", value);
            }
            bytes[12..].to_vec()
        }
        _ => panic!("recipient must be a 20-byte address or a 32-byte word: {}", value),
    };
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(&address);
    word.reverse();
    let mut repr = <Fr as PrimeField>::Repr::default();
    repr.as_mut().copy_from_slice(&word);
    Option::<Fr>::from(Fr::from_repr(repr))
        .expect("recipient is not a canonical BN254 scalar")
}

fn note_from_request(request: &NoteRequest) -> NoteNative {
    NoteNative {
        student_id: Fr::from(request.student_id),
        amount: decimal_input_to_fr(&request.amount),
        rho: decimal_string_to_fr(&request.rho),
    }
}

fn checked_tree(commitments: &[String]) -> (MerkleTree, Vec<Fr>) {
    if commitments.is_empty() {
        panic!("At least one approved commitment is required");
    }

    let capacity = 1usize << MERKLE_DEPTH;
    if commitments.len() > capacity {
        panic!(
            "Merkle depth {} supports at most {} commitments",
            MERKLE_DEPTH,
            capacity
        );
    }

    let commitment_values: Vec<Fr> = commitments
        .iter()
        .map(|commitment| bytes32_hex_to_fr(commitment))
        .collect();

    let mut tree = MerkleTree::new(MERKLE_DEPTH);
    for commitment in &commitment_values {
        tree.insert(*commitment);
    }

    (tree, commitment_values)
}

pub fn compute_commitment_only() {
    let request: NoteRequest =
        serde_json::from_str(&read_stdin()).expect("Invalid note JSON");
    let note = note_from_request(&request);
    let commitment = ScholarshipCircuit::native_commitment(&note);

    println!(
        "{}",
        serde_json::json!({
            "commitment": fr_to_bytes32_hex(commitment)
        })
    );
}

pub fn compute_nullifier_only() {
    let request: NoteRequest =
        serde_json::from_str(&read_stdin()).expect("Invalid note JSON");
    let note = note_from_request(&request);
    let nullifier = ScholarshipCircuit::native_nullifier(note.rho);

    println!(
        "{}",
        serde_json::json!({
            "nullifier": fr_to_bytes32_hex(nullifier)
        })
    );
}

pub fn compute_root_only() {
    let request: RootRequest =
        serde_json::from_str(&read_stdin()).expect("Invalid root JSON");
    let (tree, _) = checked_tree(&request.commitments);

    println!(
        "{}",
        serde_json::json!({
            "root": fr_to_bytes32_hex(tree.root()),
            "leaf_count": request.commitments.len(),
            "nodes": tree
                .nodes
                .iter()
                .map(|tang| {
                    tang.iter()
                        .map(|v| fr_to_bytes32_hex(*v))
                        .collect::<Vec<String>>()
                })
                .collect::<Vec<Vec<String>>>(),
            "zeros": tree
                .zeros
                .iter()
                .map(|v| fr_to_bytes32_hex(*v))
                .collect::<Vec<String>>()
        })
    );
}

pub fn build_inputs() -> ScholarshipCircuit {
    let request: NoteRequest =
        serde_json::from_str(&read_stdin()).expect("Invalid proof input JSON");
    let note = note_from_request(&request);
    let witness_commitment = ScholarshipCircuit::native_commitment(&note);
    let index = request
        .merkle_index
        .expect("merkle_index is required in prove mode");

    /*
     * K10 — 03/09/2026: hai duong lay Merkle path.
     *
     * A. `siblings` + `directions` gui san — backend da doc dung
     *    `depth` nut tu collection `merkleNodes`, nen prover
     *    KHONG dung lai cay. Chi phi O(depth).
     *
     * B. Khong gui — giu nguyen duong cu, dung cay tu toan bo
     *    commitment. Chi phi O(n x depth). Van la duong mac dinh
     *    nen moi lenh cu chay nguyen ven.
     *
     * Doi xung voi ADV — xem prover/src/inputs_builder.rs K10.
     */
    let co_duong_luu_san = request.siblings.len() == MERKLE_DEPTH
        && request.directions.len() == MERKLE_DEPTH;

    let witness = if co_duong_luu_san {
        eprintln!("Merkle path doc tu merkleNodes - khong dung lai cay");

        MerkleWitness {
            leaf: witness_commitment,
            siblings: request
                .siblings
                .iter()
                .map(|value| bytes32_hex_to_fr(value))
                .collect(),
            directions: request.directions.clone(),
            /*
             * `compute_root` khong doc truong `root` cua witness
             * — no tinh lai tu leaf va path. Dat tam bang leaf;
             * gia tri that la `witness_path_root` ngay duoi.
             */
            root: witness_commitment,
        }
    } else {
        let (tree, commitment_values) = checked_tree(&request.commitments);

        if index >= commitment_values.len() {
            panic!("merkle_index is outside the approved commitment list");
        }
        /*
         * KHONG panic o day.
         *
         * Guard nay chay trong prover — binary nam o phia nguoi
         * dung. Ke gian sua hoac xoa no la xong, nen no KHONG
         * phai ranh gioi tin cay. Viec tu choi thuoc ve lop
         * on-chain (Halo2Verifier + ShieldedPool.validRoot).
         *
         * Giu thong diep de nguoi dung trung thuc biet sai o dau.
         * Doi xung voi ADV — xem code/CONSTRAINT_FLOW.md muc 7b.
         */
        if commitment_values[index] != witness_commitment {
            eprintln!(
                "CANH BAO: commitment tai merkle_index khong khop note da giai ma. Proof van duoc tao; viec tu choi thuoc ve lop on-chain."
            );
        }

        eprintln!(
            "Local Merkle root        = {}",
            fr_to_bytes32_hex(tree.root())
        );

        tree.create_witness(index)
    };

    let expected_root_hex = request
        .expected_root
        .as_deref()
        .expect("expected_root is required in prove mode");
    let expected_root = bytes32_hex_to_fr(expected_root_hex);
    let nullifier = ScholarshipCircuit::native_nullifier(note.rho);

    /*
     * Root đưa vào circuit phải là root mà circuit SẼ tính ra
     * từ note — không phải currentRoot đọc từ contract.
     *
     * Circuit làm: computed_root = compute_root(leaf, path),
     * rồi assert(computed_root == expected_root). Nếu truyền
     * vào currentRoot trong khi note giả, assert vi phạm ->
     * create_proof hỏng -> lớp on-chain không bao giờ nhìn
     * thấy proof để mà từ chối.
     *
     * Truyền đúng root circuit tính ra thì proof luôn tạo
     * được, còn nó có khớp trạng thái thật hay không là việc
     * của ShieldedPool.validRoot.
     *
     * Đường trung thực không đổi: note đúng thì giá trị này
     * bằng tree.root() và bằng expected_root.
     */
    let witness_path_root = ScholarshipCircuit::native_merkle_root(
        witness_commitment,
        &witness,
    );

    if witness_path_root != expected_root {
        eprintln!(
            "CANH BAO: root dung tu note khong khop currentRoot tren smart \
             contract. Proof van duoc tao; viec tu choi thuoc ve lop on-chain."
        );
    }

    /*
     * K10 — duong luu san khong doc commitment nao, nen dem
     * theo so commitment thuc su gui vao.
     */
    eprintln!(
        "Approved commitment count = {}",
        if co_duong_luu_san { 0 } else { request.commitments.len() }
    );
    eprintln!("Merkle index = {}", index);
    eprintln!("Root from smart contract = {}", fr_to_bytes32_hex(expected_root));
    eprintln!("Root from witness path   = {}", fr_to_bytes32_hex(witness_path_root));
    eprintln!("Public nullifier = {}", fr_to_bytes32_hex(nullifier));

    /*
     * A25 — thieu vi nhan thi proof khong gan voi vi nao, va ke chep
     * proof trong mempool gui sang vi cua han van qua.
     */
    let recipient = recipient_to_fr(
        request
            .recipient
            .as_deref()
            .expect("recipient is required in prove mode"),
    );
    eprintln!("Public recipient = {}", fr_to_bytes32_hex(recipient));
    ScholarshipCircuit::new(note, witness, witness_path_root, nullifier, recipient)
}

pub fn build_keygen_circuit() -> ScholarshipCircuit {
    let note = NoteNative {
        student_id: Fr::from(1),
        amount: Fr::from(1),
        rho: Fr::from(1),
    };
    let second_note = NoteNative {
        student_id: Fr::from(2),
        amount: Fr::from(2),
        rho: Fr::from(2),
    };

    let mut tree = MerkleTree::new(MERKLE_DEPTH);
    tree.insert(ScholarshipCircuit::native_commitment(&note));
    tree.insert(ScholarshipCircuit::native_commitment(&second_note));
    let witness = tree.create_witness(0);
    let nullifier = ScholarshipCircuit::native_nullifier(note.rho);

    // Mach keygen chi can dung HINH DANG — vi nhan nao cung duoc.
    ScholarshipCircuit::new(note, witness.clone(), witness.root, nullifier, Fr::from(0))
}
