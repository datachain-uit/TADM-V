use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

fn run_prover(mode: &str, payload: &serde_json::Value, working_dir: &Path) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_prover"))
        .arg(mode)
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("prover must start in mode {mode}: {error}"));

    child
        .stdin
        .as_mut()
        .expect("prover stdin must be available")
        .write_all(payload.to_string().as_bytes())
        .expect("payload must be written to stdin");

    child.wait_with_output().unwrap_or_else(|error| panic!("prover mode {mode} must finish: {error}"))
}

fn flip_last_bit(hex_value: &str) -> String {
    let body = hex_value.strip_prefix("0x").unwrap_or(hex_value);

    let last = u8::from_str_radix(&body[body.len() - 2..], 16).expect("the last two characters must be valid hex");

    format!("0x{}{:02x}", &body[..body.len() - 2], last ^ 1)
}

#[test]
fn verify_accepts_a_genuine_proof_and_rejects_tampered_public_inputs() {
    let unique =
        SystemTime::now().duration_since(UNIX_EPOCH).expect("system clock must be after Unix epoch").as_nanos();
    let root_dir = std::env::temp_dir().join(format!("scholarship-verify-gate-{}-{unique}", std::process::id()));
    let backend_dir = root_dir.join("backend");
    fs::create_dir_all(&backend_dir).expect("temporary backend directory must be created");
    fs::create_dir_all(root_dir.join("shared")).expect("temporary shared directory must be created");

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

    let prove_output = run_prover("prove", &fixture, &backend_dir);
    if !prove_output.status.success() {
        panic!("prove must succeed: {}", String::from_utf8_lossy(&prove_output.stderr));
    }

    let proof: serde_json::Value =
        serde_json::from_slice(&prove_output.stdout).expect("prove stdout must be valid JSON");

    let proof_hex = proof["proof"].as_str().expect("proof must be a string");
    let root = proof["root"].as_str().expect("root must be a string");
    let nullifier = proof["nullifier"].as_str().expect("nullifier must be a string");
    let amount = proof["amount"].as_str().expect("amount must be a string");
    let recipient = proof["recipient"].as_str().expect("recipient must be a string");

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
        "a genuine proof must verify in a separate process: {}",
        String::from_utf8_lossy(&ok.stderr)
    );

    let verdict: serde_json::Value = serde_json::from_slice(&ok.stdout).expect("verify stdout must be valid JSON");
    assert_eq!(verdict["verified"], true);

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
        "verify MUST reject the proof when the nullifier is changed — if this passes, \
         verify blocks nothing and the paper must not claim it does"
    );
    assert!(
        String::from_utf8_lossy(&tampered_nullifier.stderr).contains("OFF-CHAIN VERIFICATION FAILED"),
        "must be rejected because verification failed, not because of a crash or a syntax error"
    );

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
    assert!(!tampered_amount.status.success(), "verify MUST reject the proof when the amount is changed");

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
        "verify MUST reject the proof when the recipient is changed — if this passes, \
         the proof is not bound to the payout wallet and can be replayed to another one"
    );
    assert!(
        String::from_utf8_lossy(&tampered_recipient.stderr).contains("OFF-CHAIN VERIFICATION FAILED"),
        "must be rejected because verification failed, not because of a crash or a syntax error"
    );

    fs::remove_dir_all(root_dir).expect("temporary proof artifacts must be removed");
}

#[test]
fn a_forged_note_still_produces_a_proof_but_verify_rejects_it() {
    let unique =
        SystemTime::now().duration_since(UNIX_EPOCH).expect("system clock must be after Unix epoch").as_nanos();
    let root_dir = std::env::temp_dir().join(format!("scholarship-forged-note-{}-{unique}", std::process::id()));
    let backend_dir = root_dir.join("backend");
    fs::create_dir_all(&backend_dir).expect("temporary backend directory must be created");
    fs::create_dir_all(root_dir.join("shared")).expect("temporary shared directory must be created");

    const REAL_COMMITMENT: &str = "0x324532af9c6dc0a464517dc959ed81e157593968354dab854e31442b336f1f0a";

    let root_output = run_prover("root", &serde_json::json!({ "commitments": [REAL_COMMITMENT] }), &backend_dir);
    assert!(root_output.status.success(), "root mode must run");

    let current_root = serde_json::from_slice::<serde_json::Value>(&root_output.stdout)
        .expect("root stdout must be valid JSON")["root"]
        .as_str()
        .expect("root must be a string")
        .to_string();

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
        "prove MUST still create a proof from a forged note — if this fails, \
         a guard went back to panicking and `verify` never gets a proof \
         to reject: {}",
        String::from_utf8_lossy(&forged.stderr)
    );

    let stderr = String::from_utf8_lossy(&forged.stderr);
    assert!(stderr.contains("WARNING"), "the prover must still warn an honest user where the mismatch is");

    let proof: serde_json::Value = serde_json::from_slice(&forged.stdout).expect("prove stdout must be valid JSON");

    let forged_root = proof["root"].as_str().expect("root must be a string");
    assert_ne!(forged_root, current_root, "the root in a forged proof must differ from the root on the contract");

    let verdict = run_prover(
        "verify",
        &serde_json::json!({
            "proof": proof["proof"].as_str().expect("proof must be a string"),
            "root": current_root,
            "nullifier": proof["nullifier"].as_str().expect("nullifier must be a string"),
            "amount": proof["amount"].as_str().expect("amount must be a string"),
            "recipient": proof["recipient"].as_str().expect("recipient must be a string"),
        }),
        &backend_dir,
    );

    assert!(
        !verdict.status.success(),
        "verify MUST reject a proof built from a forged note when checked against the root \
         read from the smart contract"
    );
    assert!(
        String::from_utf8_lossy(&verdict.stderr).contains("OFF-CHAIN VERIFICATION FAILED"),
        "must be rejected because verification failed, not because of a crash or a syntax error"
    );

    fs::remove_dir_all(root_dir).expect("temporary proof artifacts must be removed");
}
