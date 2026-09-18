/*
 * Kiểm chứng mode `verify` là CỔNG CHẶN thật,
 * không phải bước trang trí.
 *
 * Ba khẳng định:
 *   1. proof tạo ở tiến trình A verify được ở
 *      tiến trình B (chiều positive);
 *   2. đổi nullifier -> verify TỪ CHỐI;
 *   3. đổi amount    -> verify TỪ CHỐI;
 *   4. đổi recipient -> verify TỪ CHỐI (A25 — chép proof sang ví khác).
 *
 * (2) và (3) là thứ chứng minh cho câu viết về
 * off-chain verification trong bài báo. Không có
 * chúng thì không có bằng chứng nào cho thấy
 * verify có khả năng từ chối bất cứ điều gì.
 *
 * Xem VERIFY_MECHANISM.md.
 */

use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

fn run_prover(
    mode: &str,
    payload: &serde_json::Value,
    working_dir: &Path,
) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_prover"))
        .arg(mode)
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| {
            panic!("prover phải khởi động được ở mode {mode}: {error}")
        });

    child
        .stdin
        .as_mut()
        .expect("prover stdin phải mở được")
        .write_all(payload.to_string().as_bytes())
        .expect("payload phải ghi được vào stdin");

    child
        .wait_with_output()
        .unwrap_or_else(|error| {
            panic!("prover mode {mode} phải kết thúc: {error}")
        })
}

/*
 * Lật bit thấp nhất của byte cuối trong một
 * bytes32 hex. Đủ để phá giá trị nhưng vẫn giữ
 * đúng định dạng, nên nếu bị từ chối thì là do
 * verify chứ không phải do lỗi parse.
 */
fn flip_last_bit(hex_value: &str) -> String {
    let body = hex_value
        .strip_prefix("0x")
        .unwrap_or(hex_value);

    let last = u8::from_str_radix(&body[body.len() - 2..], 16)
        .expect("hai ký tự cuối phải là hex hợp lệ");

    format!("0x{}{:02x}", &body[..body.len() - 2], last ^ 1)
}

#[test]
fn verify_accepts_a_genuine_proof_and_rejects_tampered_public_inputs() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("đồng hồ hệ thống phải sau mốc Unix")
        .as_nanos();
    let root_dir = std::env::temp_dir().join(format!(
        "scholarship-verify-gate-{}-{unique}",
        std::process::id()
    ));
    let backend_dir = root_dir.join("backend");
    fs::create_dir_all(&backend_dir)
        .expect("thư mục backend tạm phải tạo được");
    fs::create_dir_all(root_dir.join("shared"))
        .expect("thư mục shared tạm phải tạo được");

    let fixture = serde_json::json!({
        "student_id": 1,
        "amount": "1000",
        "rho": "123",
        "commitments": [
            "0x324532af9c6dc0a464517dc959ed81e157593968354dab854e31442b336f1f0a"
        ],
        "merkle_index": 0,
        "recipient": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    });

    // --- Tiến trình A: tạo proof ---
    let prove_output = run_prover("prove", &fixture, &backend_dir);
    if !prove_output.status.success() {
        panic!(
            "prove phải thành công: {}",
            String::from_utf8_lossy(&prove_output.stderr)
        );
    }

    let proof: serde_json::Value =
        serde_json::from_slice(&prove_output.stdout)
            .expect("stdout của prove phải là JSON hợp lệ");

    let proof_hex = proof["proof"]
        .as_str()
        .expect("proof phải là chuỗi");
    let root = proof["root"].as_str().expect("root phải là chuỗi");
    let nullifier = proof["nullifier"]
        .as_str()
        .expect("nullifier phải là chuỗi");
    let amount = proof["amount"].as_str().expect("amount phải là chuỗi");
    let recipient = proof["recipient"]
        .as_str()
        .expect("recipient phải là chuỗi");

    // --- 1. Tiến trình B: verify với public inputs đúng ---
    let ok = run_prover(
        "verify",
        &serde_json::json!({
            "proof": proof_hex,
            "root": root,
            "nullifier": nullifier,
            "amount": amount,
            "recipient": recipient,
        }),
        &backend_dir,
    );
    assert!(
        ok.status.success(),
        "proof thật phải verify được ở tiến trình riêng: {}",
        String::from_utf8_lossy(&ok.stderr)
    );

    let verdict: serde_json::Value = serde_json::from_slice(&ok.stdout)
        .expect("stdout của verify phải là JSON hợp lệ");
    assert_eq!(verdict["verified"], true);

    // --- 2. Đổi nullifier -> phải bị từ chối ---
    let tampered_nullifier = run_prover(
        "verify",
        &serde_json::json!({
            "proof": proof_hex,
            "root": root,
            "nullifier": flip_last_bit(nullifier),
            "amount": amount,
            "recipient": recipient,
        }),
        &backend_dir,
    );
    assert!(
        !tampered_nullifier.status.success(),
        "verify PHẢI từ chối proof khi nullifier bị đổi — nếu chỗ này xanh \
         thì verify không chặn được gì và không được viết về nó trong bài báo"
    );
    assert!(
        String::from_utf8_lossy(&tampered_nullifier.stderr)
            .contains("OFF-CHAIN VERIFICATION FAILED"),
        "phải từ chối vì verify thất bại, không phải vì crash hay sai cú pháp"
    );

    // --- 3. Đổi amount -> phải bị từ chối ---
    let tampered_amount = run_prover(
        "verify",
        &serde_json::json!({
            "proof": proof_hex,
            "root": root,
            "nullifier": nullifier,
            "amount": flip_last_bit(amount),
            "recipient": recipient,
        }),
        &backend_dir,
    );
    assert!(
        !tampered_amount.status.success(),
        "verify PHẢI từ chối proof khi amount bị đổi"
    );

    // --- 4. Đổi recipient -> phải bị từ chối (A25) ---
    // Đúng phép thử của lỗ hổng chạy trước: giữ nguyên proof, đổi ví nhận.
    let tampered_recipient = run_prover(
        "verify",
        &serde_json::json!({
            "proof": proof_hex,
            "root": root,
            "nullifier": nullifier,
            "amount": amount,
            "recipient": flip_last_bit(recipient),
        }),
        &backend_dir,
    );
    assert!(
        !tampered_recipient.status.success(),
        "verify PHẢI từ chối proof khi recipient bị đổi — nếu chỗ này xanh \
         thì proof không gắn với ví nhận, chép proof sang ví khác vẫn qua"
    );
    assert!(
        String::from_utf8_lossy(&tampered_recipient.stderr)
            .contains("OFF-CHAIN VERIFICATION FAILED"),
        "phải từ chối vì verify thất bại, không phải vì crash hay sai cú pháp"
    );

    fs::remove_dir_all(root_dir)
        .expect("artifact tạm phải xoá được");
}

/*
 * Note giả đi qua ĐÚNG LUỒNG THẬT (có expected_root) vẫn
 * tạo được proof, và bị mode `verify` từ chối.
 *
 * Đây là bằng chứng mạnh hơn phép lật-1-bit ở test trên:
 * nó không sửa proof sau khi tạo, mà đưa dữ liệu giả vào
 * từ đầu, đúng cách một sinh viên gian lận sẽ làm.
 *
 * Vì sao prover KHÔNG tự chặn: guard trong inputs_builder
 * chạy ở phía người dùng (ADV còn có bản WASM chạy trong
 * trình duyệt), nên nó không phải ranh giới tin cậy. Việc
 * từ chối thuộc về verifier, nơi `root` được nạp từ smart
 * contract. Xem code/VERIFY_MECHANISM.md.
 */
#[test]
fn a_forged_note_still_produces_a_proof_but_verify_rejects_it() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("đồng hồ hệ thống phải sau mốc Unix")
        .as_nanos();
    let root_dir = std::env::temp_dir().join(format!(
        "scholarship-forged-note-{}-{unique}",
        std::process::id()
    ));
    let backend_dir = root_dir.join("backend");
    fs::create_dir_all(&backend_dir)
        .expect("thư mục backend tạm phải tạo được");
    fs::create_dir_all(root_dir.join("shared"))
        .expect("thư mục shared tạm phải tạo được");

    // Commitment của note THẬT (student_id=1, amount=1000, rho=123).
    const REAL_COMMITMENT: &str =
        "0x324532af9c6dc0a464517dc959ed81e157593968354dab854e31442b336f1f0a";

    // --- Root mà nhà trường đã duyệt lên chain ---
    let root_output = run_prover(
        "root",
        &serde_json::json!({ "commitments": [REAL_COMMITMENT] }),
        &backend_dir,
    );
    assert!(root_output.status.success(), "mode root phải chạy được");

    let current_root = serde_json::from_slice::<serde_json::Value>(&root_output.stdout)
        .expect("stdout của root phải là JSON hợp lệ")["root"]
        .as_str()
        .expect("root phải là chuỗi")
        .to_string();

    /*
     * Sinh viên khai rho = 999 thay vì 123, trong khi danh
     * sách commitment và expected_root đều là dữ liệu THẬT
     * do backend cung cấp — đúng như luồng vận hành.
     */
    let forged = run_prover(
        "prove",
        &serde_json::json!({
            "student_id": 1,
            "amount": "1000",
            "rho": "999",
            "commitments": [REAL_COMMITMENT],
            "merkle_index": 0,
            "expected_root": current_root,
            "recipient": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        }),
        &backend_dir,
    );

    assert!(
        forged.status.success(),
        "prove PHẢI vẫn tạo được proof với note giả — nếu chỗ này đỏ thì \
         một guard nào đó đã quay lại panic, và mode `verify` sẽ không bao \
         giờ có proof để từ chối: {}",
        String::from_utf8_lossy(&forged.stderr)
    );

    let stderr = String::from_utf8_lossy(&forged.stderr);
    assert!(
        stderr.contains("CẢNH BÁO"),
        "prover vẫn phải cảnh báo cho người dùng trung thực biết sai ở đâu"
    );

    let proof: serde_json::Value = serde_json::from_slice(&forged.stdout)
        .expect("stdout của prove phải là JSON hợp lệ");

    let forged_root = proof["root"].as_str().expect("root phải là chuỗi");
    assert_ne!(
        forged_root, current_root,
        "root trong proof giả phải khác root trên contract"
    );

    // --- Verify bằng root THẬT lấy từ contract ---
    let verdict = run_prover(
        "verify",
        &serde_json::json!({
            "proof": proof["proof"].as_str().expect("proof phải là chuỗi"),
            "root": current_root,
            "nullifier": proof["nullifier"].as_str().expect("nullifier phải là chuỗi"),
            "amount": proof["amount"].as_str().expect("amount phải là chuỗi"),
            "recipient": proof["recipient"].as_str().expect("recipient phải là chuỗi"),
        }),
        &backend_dir,
    );

    assert!(
        !verdict.status.success(),
        "verify PHẢI từ chối proof dựng từ note giả khi đối chiếu với root \
         lấy từ smart contract"
    );
    assert!(
        String::from_utf8_lossy(&verdict.stderr)
            .contains("OFF-CHAIN VERIFICATION FAILED"),
        "phải từ chối vì verify thất bại, không phải vì crash hay sai cú pháp"
    );

    fs::remove_dir_all(root_dir)
        .expect("artifact tạm phải xoá được");
}
