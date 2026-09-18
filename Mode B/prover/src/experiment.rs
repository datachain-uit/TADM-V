use std::{
    fs,
    time::Instant,
};

use serde_json::json;

use rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;

use ff_ce::hex;

use halo2_base::halo2_proofs::{
    halo2curves::bn256::{Bn256, Fr, G1Affine},
    poly::kzg::commitment::{KZGCommitmentScheme, ParamsKZG},
    poly::kzg::multiopen::{ProverSHPLONK, VerifierSHPLONK},
    poly::kzg::strategy::AccumulatorStrategy,
    poly::commitment::ParamsProver,
    poly::VerificationStrategy,
    plonk::{create_proof, keygen_pk, keygen_vk, verify_proof},
    transcript::{TranscriptReadBuffer, TranscriptWriterBuffer},
};

use rand_core::{OsRng, RngCore};

use snark_verifier::loader::evm::encode_calldata;
use snark_verifier::system::halo2::transcript::evm::EvmTranscript;

use crate::inputs_builder::{
    ExperimentDatasetInput,
    build_circuit_from_experiment_dataset,
    build_experiment_tree,
    build_circuit_from_tree,
};

/*
 * LAP20 (16/09/2026) — K khong con la hang so o day.
 *
 * `circuits::circuit::k_mach()` doc bien `HALO2_K` (mac dinh 13) va CHINH NO
 * cung quyet dinh `use_k` cua mach. Lay chung mot nguon nen params KZG va
 * mach KHONG BAO GIO lech K.
 */
fn k() -> u32 {
    circuits::circuit::k_mach() as u32
}

/*
 * LAP20 (14/09/2026) — runner lap lai can: (1) ghi ket qua vao THU MUC RIENG
 * cua tung luot, (2) chay warm-up truoc lan do that. Ca hai qua bien moi
 * truong de KHONG doi cu phap lenh `bench-from-dataset`; khong dat bien thi
 * hanh vi y het truoc (ghi vao experiments/results/quantitative, 0 warm-up).
 */
fn thu_muc_ra() -> String {
    std::env::var("BENCH_OUT_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            "../experiments/results/quantitative".to_string()
        })
}

fn so_warmup() -> usize {
    match std::env::var("BENCH_WARMUP") {
        Err(_) => 0,

        Ok(gia_tri) =>
            gia_tri
                .trim()
                .parse()
                .unwrap_or_else(|_| {
                    panic!("BENCH_WARMUP khong hop le: {:?}", gia_tri)
                }),
    }
}

fn setup_fixed_params()
-> ParamsKZG<Bn256> {
    let rng =
        ChaCha20Rng::from_seed(
            [42u8; 32]
        );

    ParamsKZG::<Bn256>::setup(
        k(),
        rng
    )
}

fn extract_instances(
    builder: &halo2_base::gates::circuit::builder::BaseCircuitBuilder<Fr>
) -> Vec<Vec<Fr>> {
    builder
        .assigned_instances
        .iter()
        .map(|column| {
            column
                .iter()
                .map(|assigned| *assigned.value())
                .collect()
        })
        .collect()
}

// ============================================================
// MODE 1: EXPORT VERIFIER SOLIDITY
// ============================================================
//
// Chạy mode này trước Hardhat compile.
// Nó sẽ sinh:
// contracts/contracts/Halo2Verifier.sol
//

pub fn export_verifier_from_dataset_file(
    dataset_path: &str
) {
    let raw =
        fs::read_to_string(
            dataset_path
        ).expect("Cannot read experiment dataset file");

    let dataset: ExperimentDatasetInput =
        serde_json::from_str(
            &raw
        ).expect("Invalid experiment dataset JSON");

    println!(
        "Exporting Halo2Verifier.sol from dataset: {}",
        dataset_path
    );

    println!(
        "n = {}",
        dataset.n
    );

    println!(
        "Merkle depth = {}",
        dataset.merkle_depth
    );

    println!(
        "K = {}",
        k()
    );

    let params =
        setup_fixed_params();

    let sample_circuit =
        build_circuit_from_experiment_dataset(
            &dataset,
            0
        );

    let sample_builder =
        sample_circuit.create_builder();

    let vk =
        keygen_vk(
            &params,
            &sample_builder
        ).expect("keygen_vk failed");

    crate::export_verifier::export_verifier(
        &params,
        &vk
    );

    println!(
        "Halo2Verifier.sol exported successfully."
    );
}

// ============================================================
// MODE: CHECK-K (LAP20, 16/09/2026)
// ============================================================
//
// Kiem K hien tai (`HALO2_K`) co du hang cho mach o do sau cua dataset
// khong — dung phep thu da dung de chon K = 13: keygen_vk tren mach mau,
// thieu hang thi bao loi.
//
// Thieu hang => panic, ma thoat khac 0. Runner lap20 doc ma thoat de tim
// K nho nhat cho tung d. KHONG ghi file nao.
//

pub fn check_k_from_dataset_file(
    dataset_path: &str
) {
    let raw =
        fs::read_to_string(
            dataset_path
        ).expect("Cannot read experiment dataset file");

    let dataset: ExperimentDatasetInput =
        serde_json::from_str(
            &raw
        ).expect("Invalid experiment dataset JSON");

    let bat_dau =
        Instant::now();

    let sample_circuit =
        build_circuit_from_experiment_dataset(
            &dataset,
            0
        );

    let sample_builder =
        sample_circuit.create_builder();

    let params =
        setup_fixed_params();

    match keygen_vk(&params, &sample_builder) {
        Ok(_) => {
            println!(
                "{{\"k\":{},\"merkle_depth\":{},\"ok\":true,\"check_ms\":{:.3}}}",
                k(),
                dataset.merkle_depth,
                bat_dau.elapsed().as_secs_f64() * 1000.0
            );
        }

        Err(error) => {
            panic!(
                "K = {} khong du cho merkle_depth = {}: {:?}",
                k(),
                dataset.merkle_depth,
                error
            );
        }
    }
}

// ============================================================
// MODE 2: GENERATE PROOFS FROM DATASET
// ============================================================
//
// Chạy mode này để đo proof generation time.
// Nó tạo:
// experiments/results/quantitative/proofs_n*.json
// experiments/results/quantitative/performance_onchain_n*.csv
//

pub fn run_benchmark_from_dataset_file(
    dataset_path: &str
) {
    fs::create_dir_all(
        thu_muc_ra()
    ).unwrap();

    let raw =
        fs::read_to_string(
            dataset_path
        ).expect("Cannot read experiment dataset file");

    let dataset: ExperimentDatasetInput =
        serde_json::from_str(
            &raw
        ).expect("Invalid experiment dataset JSON");

    println!(
        "Running proof generation benchmark from dataset: {}",
        dataset_path
    );

    println!(
        "n = {}",
        dataset.n
    );

    println!(
        "Merkle depth = {}",
        dataset.merkle_depth
    );

    println!(
        "K = {}",
        k()
    );

    // =====================================================
    // SETUP + KEYGEN
    // =====================================================
    //
    // setup_ms — chi phi MOT LAN cua ca he (nap params + keygen).
    // Do rieng, KHONG cong vao proof_generation_ms (spec D1).
    //

    /*
     * SUA 2026-08-25 — dua viec DUNG MACH ra NGOAI dong ho setup.
     *
     * BAN CU dat `build_circuit_from_experiment_dataset` BEN TRONG
     * `t_setup`. Ham do dung CA CAY MERKLE tu n sinh vien, nen
     * `setup_ms` phinh theo n: 1 280 ms (n=1) -> 11 318 ms (n=100),
     * trong khi keygen KHONG co ly do phu thuoc n.
     *
     * Spec D1 ghi ro:
     *     setup_ms | nap params + keygen_vk + keygen_pk
     *              | KHONG duoc gom: dung cay, sinh proof
     *
     * Nhanh off-chain lam dung ngay tu dau (tach ba moc roi ranh:
     * moc dung cay ket thuc TRUOC khi moc setup bat dau). Day la sua
     * de ONC khop lai voi ADV va voi chinh spec.
     *
     * `create_builder()` cung nam ngoai, vi trong vong lap moi sinh
     * vien no duoc tinh vao `witness_ms` — de trong setup thi hai cho
     * dem cung mot viec theo hai cach.
     */
    let sample_circuit =
        build_circuit_from_experiment_dataset(
            &dataset,
            0
        );

    let sample_builder =
        sample_circuit.create_builder();

    let t_setup =
        Instant::now();

    let params =
        setup_fixed_params();

    let vk =
        keygen_vk(
            &params,
            &sample_builder
        ).expect("keygen_vk failed");

    let pk =
        keygen_pk(
            &params,
            vk.clone(),
            &sample_builder
        ).expect("keygen_pk failed");

    let setup_ms =
        t_setup.elapsed().as_secs_f64()
        * 1000.0;

    // =====================================================
    // OUTPUT FILES
    // =====================================================

    let csv_path =
        format!(
            "{}/performance_onchain_n{}.csv",
            thu_muc_ra(),
            dataset.n
        );

    let proofs_path =
        format!(
            "{}/proofs_n{}.json",
            thu_muc_ra(),
            dataset.n
        );

    let mut csv =
        String::from(
            "mechanism,n,student_index,witness_ms,setup_ms,prove_ms,proof_generation_ms,verify_native_ms,verified,proof_bytes,calldata_bytes,root,nullifier\n"
        );

    let mut proofs_json =
        Vec::new();

    // =====================================================
    // GENERATE PROOF FOR EACH STUDENT
    // =====================================================

    /*
     * K10 — 03/09/2026: dung cay MOT LAN, ngoai vong lap.
     *
     * Truoc day moi vong lap dung lai ca cay tu n commitment,
     * nen `tree_and_witness_ms` chua n x depth phep bam MOI
     * proof. Bay gio trong vong lap chi con `create_witness`,
     * tuc O(depth) — dung nhu luong that sau K10, noi
     * `approveRoot` luu cay va `createWithdrawalRequest` doc
     * `depth` nut.
     *
     * Chi phi dung cay khong bien mat, no chi duoc tra MOT lan
     * cho ca pool thay vi mot lan cho moi luot rut.
     */
    let t_cay_mot_lan =
        Instant::now();

    let (
        cay_kich_ban,
        notes_kich_ban
    ) =
        build_experiment_tree(
            &dataset
        );

    let tree_build_once_ms =
        t_cay_mot_lan.elapsed().as_secs_f64()
        * 1000.0;

    println!(
        "Merkle tree built once for the scenario: {:.1} ms",
        tree_build_once_ms
    );

    /*
     * LAP20 — warm-up chay TRUOC cac lan do that, cung mot than vong lap
     * (student_index = lan % n), SAU keygen — nen no lam nong dung tien
     * trinh se sinh cac proof do that. Dong CSV cua warm-up VAN duoc ghi,
     * nam o DAU file (dung `so_warmup()` dong), de minh bach; runner lap20
     * danh dau chung `warmup = true` va loai khoi Mean ± SD. Proof warm-up
     * KHONG vao proofs_n*.json.
     */
    let so_lan_warmup =
        so_warmup();

    let tong_lan =
        so_lan_warmup
        + dataset.students.len();

    for lan in 0..tong_lan {
        let la_warmup =
            lan < so_lan_warmup;

        let student_index =
            if la_warmup {
                lan % dataset.students.len()
            } else {
                lan - so_lan_warmup
            };

        println!(
            "Generating proof for student_index = {}{}",
            student_index,
            if la_warmup { " (warm-up)" } else { "" }
        );

        // ---------------------------------------------
        // 1. Build Merkle tree + witness + circuit input
        // ---------------------------------------------

        // A25 — vi nhan tien, doi ra phan tu truong NGOAI dong ho do.
        let recipient =
            crate::flow_inputs::recipient_to_fr(
                &dataset.students[student_index].address
            );

        let t_tree =
            Instant::now();

        let circuit_data =
            build_circuit_from_tree(
                &cay_kich_ban,
                &notes_kich_ban,
                student_index,
                recipient
            );

        let tree_and_witness_ms =
            t_tree.elapsed().as_secs_f64()
            * 1000.0;

        // ---------------------------------------------
        // 2. Dung builder + trich instances  ->  WITNESS
        // ---------------------------------------------
        //
        // Spec D1: hai buoc nay la CHUAN BI DU LIEU, khong phai sinh
        // proof. Ban cu bo chung vao `prove_ms` nen con so C-1 cua
        // nhanh nay bi cong oan so voi nhanh off-chain.

        let t_witness_2 =
            Instant::now();

        let builder =
            circuit_data.create_builder();

        let instances =
            extract_instances(
                &builder
            );

        let witness_ms =
            tree_and_witness_ms
            + t_witness_2.elapsed().as_secs_f64() * 1000.0;

        // ---------------------------------------------
        // 3. Sinh proof  ->  PROVE  (KHONG kem verify)
        // ---------------------------------------------
        //
        // KHONG dung `gen_evm_proof_shplonk`.
        //
        // Ham do chay `create_proof` xong lam NGUYEN MOT LAN
        // `verify_proof` + `assert!(accept)`, va khoi do KHONG nam sau
        // `#[cfg(debug_assertions)]` nen chay ca o ban release — kiem
        // tu snark-verifier-sdk-0.2.3/src/evm.rs. Dung thang no thi
        // `prove_ms` bi cong oan mot lan verify.
        //
        // Duoi day lam DUNG CHUNG AY VIEC, chi khac la HAI DONG HO
        // rieng — verify VAN CHAY (buoc 4), chi la do duoc rieng.
        // Thu vien giu nguyen: khong patch, khong fork.

        let instances_ref: Vec<&[Fr]> =
            instances
                .iter()
                .map(|x| x.as_slice())
                .collect();

        let t_prove =
            Instant::now();

        /*
         * RNG cho create_proof — PHAI la PRNG trong bo nho, gieo MOT LAN.
         *
         * `gen_evm_proof` dung `StdRng::from_entropy()`. Truyen thang
         * `OsRng` vao thay the la SAI VE HIEU NANG: `create_proof` xin
         * rat nhieu so ngau nhien de blind, va OsRng goi he dieu hanh
         * cho TUNG so. Da do that: prove_ms tang tu ~670 ms len
         * ~2 235 ms — gap 3,3 lan, va do la chi phi cua RNG chu khong
         * phai cua viec sinh proof.
         *
         * ChaCha20Rng gieo tu OsRng cho dung ngu nghia: entropy that o
         * lan gieo, con lai chay trong bo nho.
         */
        let mut hat = [0u8; 32];
        OsRng.fill_bytes(&mut hat);
        let rng_prove = ChaCha20Rng::from_seed(hat);

        let proof = {
            let mut transcript =
                TranscriptWriterBuffer::<
                    _,
                    G1Affine,
                    _
                >::init(Vec::new());

            create_proof::<
                KZGCommitmentScheme<Bn256>,
                ProverSHPLONK<'_, Bn256>,
                _,
                _,
                EvmTranscript<_, _, _, _>,
                _
            >(
                &params,
                &pk,
                &[builder],
                &[&instances_ref[..]],
                rng_prove,
                &mut transcript,
            )
            .expect("create_proof that bai");

            transcript.finalize()
        };

        let prove_ms =
            t_prove.elapsed().as_secs_f64()
            * 1000.0;

        // ---------------------------------------------
        // 4. Verify NATIVE  ->  cot so sanh duoc ba nhanh
        // ---------------------------------------------
        //
        // Day chinh la khoi vua tach khoi `gen_evm_proof`. No van chay
        // nhu truoc, nhung gio vao cot `verify_native_ms` — cot duy
        // nhat cho phep so chi phi mat ma cua ba thu vien voi nhau,
        // vi khong dinh EVM lan RPC (spec D2).

        let t_verify =
            Instant::now();

        let verified = {
            let mut transcript =
                TranscriptReadBuffer::<
                    _,
                    G1Affine,
                    _
                >::init(proof.as_slice());

            VerificationStrategy::<
                _,
                VerifierSHPLONK<'_, Bn256>
            >::finalize(
                verify_proof::<
                    _,
                    VerifierSHPLONK<'_, Bn256>,
                    _,
                    EvmTranscript<_, _, _, _>,
                    _
                >(
                    params.verifier_params(),
                    pk.get_vk(),
                    AccumulatorStrategy::new(
                        params.verifier_params()
                    ),
                    &[&instances_ref[..]],
                    &mut transcript,
                )
                .expect("verify_proof that bai")
            )
        };

        let verify_native_ms =
            t_verify.elapsed().as_secs_f64()
            * 1000.0;

        assert!(
            verified,
            "proof vua sinh KHONG qua verify native (student_index = {})",
            student_index
        );

        let calldata =
            encode_calldata(
                &instances,
                &proof
            );

        let calldata_hex =
            format!(
                "0x{}",
                hex::encode(
                    &calldata
                )
            );

        let root_hex =
            format!(
                "0x{}",
                hex::encode(
                    &calldata[0..32]
                )
            );

        let nullifier_hex =
            format!(
                "0x{}",
                hex::encode(
                    &calldata[32..64]
                )
            );

        // A25 — word thu 4 cua calldata la vi nhan.
        let recipient_hex =
            format!(
                "0x{}",
                hex::encode(
                    &calldata[96..128]
                )
            );

        // proof_generation_ms = witness + prove.
        // KHONG cong setup_ms — chi phi MOT LAN cua ca he (spec D1).
        let proof_generation_ms =
            witness_ms
            + prove_ms;

        csv.push_str(
            &format!(
                "onchain,{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{},{}\n",
                dataset.n,
                student_index,
                witness_ms,
                setup_ms,
                prove_ms,
                proof_generation_ms,
                verify_native_ms,
                verified,
                proof.len(),
                calldata.len(),
                root_hex,
                nullifier_hex
            )
        );

        // LAP20 — proof warm-up khong vao proofs_n*.json.
        if la_warmup {
            continue;
        }

        proofs_json.push(
            json!({
                "mechanism": "onchain",
                "n": dataset.n,
                "student_index": student_index,
                "ganache_account_index": dataset.students[student_index].ganache_account_index,
                "address": dataset.students[student_index].address,
                "cid": dataset.students[student_index].cid,
                "student_id": dataset.students[student_index].student_id,
                "preparation_ms": dataset.students[student_index].preparation_ms,
                "witness_ms": witness_ms,
                "setup_ms": setup_ms,
                "prove_ms": prove_ms,
                "proof_generation_ms": proof_generation_ms,
                "verify_native_ms": verify_native_ms,
                "verified": verified,
                "proof_bytes": proof.len(),
                "calldata_bytes": calldata.len(),
                "calldata": calldata_hex,
                "root": root_hex,
                "nullifier": nullifier_hex,
                "recipient": recipient_hex
            })
        );
    }

    fs::write(
        csv_path,
        csv
    ).unwrap();

    fs::write(
        proofs_path,
        serde_json::to_string_pretty(
            &proofs_json
        ).unwrap()
    ).unwrap();

    println!(
        "Proof generation benchmark finished for n = {}",
        dataset.n
    );
}