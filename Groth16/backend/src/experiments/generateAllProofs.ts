// =============================================================================
// BƯỚC 2 — sinh proof Groth16 + đo thời gian, theo DINH_NGHIA_PHEP_DO.md
//
// 🔴 Bốn ranh giới bắt buộc (mục 3, Đ1 + Đ2). Sai một cái là cả phép so hỏng,
//    và nhìn vào CSV KHÔNG phát hiện được:
//
//   witness_ms        = lấy đường Merkle + gán witness vào mạch
//                       ✅ K10 (03/09): KHÔNG còn gồm bước DỰNG CÂY — cây dựng
//                       một lần cho cả kịch bản ở prepareInputs.ts, giống hai
//                       nhánh chính (chúng lưu cây vào merkleNodes lúc duyệt
//                       root, mỗi lượt rút chỉ đọc d nút).
//                       KHÔNG gồm nạp zkey, KHÔNG gồm sinh proof
//   setup_ms          = nạp withdraw_final.zkey (chi phí MỘT LẦN của cả hệ)
//                       KHÔNG cộng vào proof_generation_ms
//   prove_ms          = ĐÚNG một lời gọi sinh proof
//                       KHÔNG gồm dựng witness, KHÔNG gồm verify, KHÔNG gồm calldata
//   verify_native_ms  = groth16.verify() trong tiến trình, KHÔNG qua mạng
//
//   proof_generation_ms = witness_ms + prove_ms      <- số điền bảng 2.1.1
//
// ⚠️ Bản trước dùng snarkjs.groth16.fullProve() — gộp witness + prove làm một,
//    nên witness_ms TRỐNG mọi dòng và prove_ms bị cộng oan phần dựng witness.
//    Nay tách bằng wtns.calculate() rồi groth16.prove(), đúng như spec mục 8.
//
// 📌 d = 9, bảy kịch bản n = {1,10,30,60,100,353,500} => 1 054 mẫu, khớp ADV/ONC.
// =============================================================================

const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { performance } = require("perf_hooks");

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const INPUT_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/data"
    );

/*
 * Where results are written. Unset => experiments/results/quantitative, the
 * lot the paper quotes. Set THU_MUC_KQ to write a test run somewhere else and
 * leave that lot untouched.
 */
const RESULT_DIR =
    path.resolve(
        PROJECT_ROOT,
        process.env.THU_MUC_KQ
        || "experiments/results/quantitative"
    );

const BUILD_DIR =
    path.resolve(
        PROJECT_ROOT,
        "build"
    );

const WASM_PATH =
    path.resolve(
        BUILD_DIR,
        "withdraw_js/withdraw.wasm"
    );

const ZKEY_PATH =
    path.resolve(
        BUILD_DIR,
        "withdraw_final.zkey"
    );

const VKEY_PATH =
    path.resolve(
        BUILD_DIR,
        "verification_key.json"
    );

// Day kich ban moi — 2026-09-07, theo hai nhanh chinh.
//   1-100 : cac diem quy mo cua Chen va cs., CCSB 2025, tr. 204-208, bang V
//   353   : quy mo THAT lon nhat cua UIT (QD 653/QD-DHCNTT)
//   500   : diem do khop Epoch 2 cua Nguyen-Hoang va cs., IEEE Access t.12
// Tong 1 054 sinh vien moi nhanh.
//
// 🔴 353 va 500 phai viet HAI CAU KHAC NHAU trong bai: 353 la quy mo THAT,
// 500 la DIEM DO khop baseline [B2]. "Quy mo that toi 500" la sai.
const SCENARIOS =
    [1, 10, 30, 60, 100, 500];

function chonKichBan(): number[] {

    const bien =
        process.env.KICH_BAN;

    if (!bien) {
        return SCENARIOS;
    }

    return bien
        .split(",")
        .map(
            (x: string) => Number(x.trim())
        )
        .filter(
            (x: number) => SCENARIOS.indexOf(x) !== -1
        );
}

// =========================
// CALLDATA
// =========================

function demByteCalldata(
    calldata: string
): number {
    // exportSolidityCallData tra ve chuoi hex co dau ngoac. Dem so byte THAT
    // cua phan du lieu: moi "0x" + 64 ky tu = 32 byte.
    const hex =
        calldata.match(/0x[0-9a-fA-F]+/g) || [];

    return hex.reduce(
        (
            tong: number,
            h: string
        ) => tong + (h.length - 2) / 2,
        0
    );
}

// =========================
// MAIN
// =========================

async function main() {

    for (const p of [WASM_PATH, ZKEY_PATH, VKEY_PATH]) {

        if (!fs.existsSync(p)) {
            throw new Error(
                `Thieu ${p}\n`
                + `Chay cac buoc bien dich mach va trusted setup truoc`
                + ` — xem FULL_FLOW_TEST.md muc 2 va 3.`
            );
        }
    }

    fs.mkdirSync(
        RESULT_DIR,
        {
            recursive: true
        }
    );

    // -------------------------------------------------------------
    // setup_ms — chi phi MOT LAN cua ca he, do mot lan o day.
    // Spec Dinh nghia phep do, D1: KHONG cong vao proof_generation_ms.
    // -------------------------------------------------------------

    const tSetup =
        performance.now();

    const vkey =
        JSON.parse(
            fs.readFileSync(
                VKEY_PATH,
                "utf8"
            )
        );

    const zkeyBuffer =
        new Uint8Array(
            fs.readFileSync(
                ZKEY_PATH
            )
        );

    const setupMs =
        performance.now() - tSetup;

    const tomTat: any[] = [];

    for (const n of chonKichBan()) {

        const inputFile =
            path.resolve(
                INPUT_DIR,
                `inputs_n${n}.json`
            );

        if (!fs.existsSync(inputFile)) {
            throw new Error(
                `Thieu ${inputFile} — chay buoc prepareInputs truoc.`
            );
        }

        const goi =
            JSON.parse(
                fs.readFileSync(
                    inputFile,
                    "utf8"
                )
            );

        // -----------------------------------------------------------------
        // CHOT BO QUA KICH BAN DA DO — muc 6 CAP_NHAT_DINH_LUONG.md
        // -----------------------------------------------------------------
        //
        // ADV va ONC deu bo qua kich ban da co file proof. Luot chay lai dau
        // tien cua tac gia bo qua sach BAY kich ban trong 2 giay ma nhin log
        // khong ro. => Bo qua thi phai HET TO, va phai noi ro cach ep chay lai.

        const proofPathCu =
            path.resolve(
                RESULT_DIR,
                `proofs_groth16_n${n}.json`
            );

        // Bo qua CHI khi file proof MOI HON ca zkey lan file input. Doi mach,
        // chay lai ceremony, hay sinh lai input => proof cu HET HAN, phai sinh
        // lai. Khong so mtime thi chot nay thanh bay: no im lang giu proof d=7
        // trong khi mach da sang d=9.
        const proofCuConHan =
            fs.existsSync(proofPathCu)
            && fs.statSync(proofPathCu).mtimeMs
                > fs.statSync(ZKEY_PATH).mtimeMs
            && fs.statSync(proofPathCu).mtimeMs
                > fs.statSync(inputFile).mtimeMs;

        if (
            fs.existsSync(proofPathCu)
            && !proofCuConHan
        ) {
            console.error(
                `  n=${n}: file proof cu HET HAN (cu hon zkey hoac input)`
                + ` — sinh lai.`
            );
        }

        if (
            proofCuConHan
            && process.env.EP_CHAY_LAI !== "1"
        ) {
            console.error(
                [
                    "",
                    "  ################################################",
                    `  # BO QUA n = ${n} — da co file proof tu luot truoc`,
                    `  #   ${path.relative(PROJECT_ROOT, proofPathCu)}`,
                    "  #",
                    "  # KHONG co proof nao duoc sinh lai o kich ban nay.",
                    "  # Doi mach / doi d / doi ceremony => file cu HET HAN,",
                    "  # phai xoa hoac dat EP_CHAY_LAI=1.",
                    "  ################################################",
                    ""
                ].join("\n")
            );

            tomTat.push({
                n,
                boQua: true,
                lyDo: "da co file proof; dat EP_CHAY_LAI=1 de sinh lai"
            });

            continue;
        }

        const proofs: any[] = [];

        // Luoc do cot: DINH_NGHIA_PHEP_DO.md muc 4.1 — GIONG HET ADV/ONC.
        let csv =
            "mechanism,n,student_index,"
            + "witness_ms,setup_ms,prove_ms,proof_generation_ms,"
            + "verify_native_ms,verified,"
            + "proof_bytes,calldata_bytes,"
            + "root,nullifier\n";

        for (const muc of goi.inputs) {

            // ---------------------------------------------------------
            // witness_ms — CHI dung witness
            // ---------------------------------------------------------

            const tWitness =
                performance.now();

            const wtnsBuffer =
                { type: "mem" } as any;

            await snarkjs.wtns.calculate(
                muc.input,
                WASM_PATH,
                wtnsBuffer
            );

            const witnessMs =
                performance.now() - tWitness;

            // ---------------------------------------------------------
            // prove_ms — DUNG mot loi goi sinh proof
            // KHONG verify, KHONG ma hoa calldata trong khoang nay
            // ---------------------------------------------------------

            const tProve =
                performance.now();

            const {
                proof,
                publicSignals
            } =
                await snarkjs.groth16.prove(
                    zkeyBuffer,
                    wtnsBuffer
                );

            const proveMs =
                performance.now() - tProve;

            // ---------------------------------------------------------
            // verify_native_ms — verify TRONG TIEN TRINH, khong qua mang.
            // Day la cot cho phep so chi phi mat ma cua ba thu vien (D2).
            // ---------------------------------------------------------

            const tVerify =
                performance.now();

            const verified =
                await snarkjs.groth16.verify(
                    vkey,
                    publicSignals,
                    proof
                );

            const verifyNativeMs =
                performance.now() - tVerify;

            if (verified !== true) {
                throw new Error(
                    `groth16.verify tra ve ${verified} o student_index=`
                    + `${muc.student_index}, n=${n}. Proof khong hop le —`
                    + ` DUNG, dung ghi so nay vao ket qua.`
                );
            }

            // ---------------------------------------------------------
            // Calldata — NGOAI moi dong ho o tren
            // ---------------------------------------------------------

            const calldata =
                await snarkjs.groth16.exportSolidityCallData(
                    proof,
                    publicSignals
                );

            const proofBytes =
                Buffer.from(
                    JSON.stringify(proof)
                ).length;

            const calldataBytes =
                demByteCalldata(calldata);

            const root =
                publicSignals[0];

            const nullifier =
                publicSignals[1];

            proofs.push({
                student_index: muc.student_index,
                address: muc.address,
                proof,
                publicSignals,
                calldata
            });

            csv += [
                "groth16",
                n,
                muc.student_index,
                witnessMs.toFixed(6),
                setupMs.toFixed(6),
                proveMs.toFixed(6),
                (witnessMs + proveMs).toFixed(6),
                verifyNativeMs.toFixed(6),
                "true",
                proofBytes,
                calldataBytes,
                root,
                nullifier
            ].join(",") + "\n";
        }

        const proofPath =
            path.resolve(
                RESULT_DIR,
                `proofs_groth16_n${n}.json`
            );

        fs.writeFileSync(
            proofPath,
            JSON.stringify(
                proofs,
                null,
                2
            )
        );

        const csvPath =
            path.resolve(
                RESULT_DIR,
                `performance_groth16_n${n}.csv`
            );

        fs.writeFileSync(
            csvPath,
            csv
        );

        console.error(
            `n=${n}: ${proofs.length} proof, tat ca verify native OK`
        );

        tomTat.push({
            n,
            soProof: proofs.length,
            proofFile: path.relative(PROJECT_ROOT, proofPath),
            csvFile: path.relative(PROJECT_ROOT, csvPath)
        });
    }

    console.log(
        JSON.stringify(
            {
                buoc: "generateAllProofs",
                heChungMinh: "groth16 (circom/snarkjs)",
                setup_ms: Number(setupMs.toFixed(6)),
                ghiChu:
                    "setup_ms do MOT LAN (nap zkey + vkey), lap lai o moi dong"
                    + " CSV cho tien doc. KHONG cong vao proof_generation_ms.",
                kichBan: tomTat
            },
            null,
            2
        )
    );
}

main()
    .then(
        () => process.exit(0)
    )
    .catch(
        (error: any) => {
            console.error(error);
            process.exit(1);
        }
    );
