use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn creates_and_verifies_a_real_proof_from_fixture() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "scholarship-prover-smoke-{}-{unique}",
        std::process::id()
    ));
    let backend_dir = root.join("backend");
    let shared_dir = root.join("shared");
    fs::create_dir_all(&backend_dir)
        .expect("temporary backend directory must be created");
    fs::create_dir_all(&shared_dir)
        .expect("temporary shared directory must be created");

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

    let mut child = Command::new(env!("CARGO_BIN_EXE_prover"))
        .arg("prove")
        .current_dir(&backend_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("prover binary must start");
    child
        .stdin
        .as_mut()
        .expect("prover stdin must be available")
        .write_all(fixture.to_string().as_bytes())
        .expect("fixture must be written to prover stdin");

    let output = child
        .wait_with_output()
        .expect("prover process must complete");

    if !output.status.success() {
        panic!(
            "prover failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let proof: serde_json::Value = serde_json::from_slice(&output.stdout)
        .expect("prover stdout must be valid JSON");
    let keys = proof
        .as_object()
        .expect("proof output must be an object")
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    // `prove` also reports the timing breakdown that feeds C-1/C-2
    // (see CLAUDE.md). The set is asserted in full so that a NEW key
    // appearing here fails loudly — that is how a private witness
    // would leak into the prover's public output.
    let expected = [
        "amount",
        "nullifier",
        "proof",
        "recipient",
        "root",
        "tree_and_witness_ms",
        "setup_ms",
        "prove_ms",
        "total_ms",
    ]
    .into_iter()
    .collect::<std::collections::BTreeSet<_>>();

    assert_eq!(keys, expected);
    assert!(proof["proof"].as_str().is_some_and(|value| !value.is_empty()));
    assert_eq!(
        proof["amount"],
        "0x00000000000000000000000000000000000000000000000000000000000003e8"
    );
    // A25 — ví nhận ra dạng word 32 byte đệm trái, như Solidity mã hoá address.
    assert_eq!(
        proof["recipient"],
        "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"
    );
    assert!(shared_dir.join("proof.bin").exists());
    assert!(shared_dir.join("proof.json").exists());

    fs::remove_dir_all(root)
        .expect("temporary proof artifacts must be removed");
}
