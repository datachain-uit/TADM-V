// =============================================================================
// BƯỚC 1 — sinh input.json cho circom, từ CHÍNH bảy dataset của bài
//
// 🔴 CHỈ ĐỌC zk-halo2-onchain/experiments/data/dataset_n*.json.
//    Không sao chép, không sinh lại. BAY file do trung NOI DUNG voi ban ADV
//    (SHA-256 CHUAN HOA khop 7/7) va la can cu cho cau "cung bo du lieu".
//    🔴 Sua 06/09: KHONG trung byte — ADV dung CRLF, ONC dung LF nen SHA-256
//    THO lech o 3/7 file. Khong phep do nao bi anh huong (prover doc JSON),
//    nhung CAM viet "trung tung byte" hay "da checksum" vao bai.
//    Sinh lại sẽ ra rho mới, làm lệch cả hai repo — CLAUDE.md cấm.
//
// Đầu ra: experiments/data/inputs_n<N>.json — mảng input cho snarkjs.
// =============================================================================

const fs = require("fs");
const path = require("path");

const {
    MERKLE_DEPTH,
    MerkleTree,
    createCommitment,
    createNullifier
} = require("../utils/merkleTree");

// =========================
// PATHS
// =========================

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

// Đi ngược ra code/ rồi sang repo on-chain. CHỈ ĐỌC.
/*
 * The datasets are read, never written. In the artifact they sit in the
 * sibling `Mode B` folder; in the original development layout the baseline
 * sits next to the two repositories instead. Try both.
 */
const DATASET_DIR =
    [
        "../Mode B/experiments/data",
        "../../zk-halo2-onchain/experiments/data"
    ]
        .map((p: string) => path.resolve(PROJECT_ROOT, p))
        .find((p: string) => fs.existsSync(p))
    || path.resolve(
        PROJECT_ROOT,
        "../Mode B/experiments/data"
    );

const OUT_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/data"
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

// =========================
// MAIN
// =========================

async function main() {

    if (!fs.existsSync(DATASET_DIR)) {
        throw new Error(
            `Khong thay dataset goc: ${DATASET_DIR}\n` +
            `Thu muc baseline phai nam canh hai repo trong code/.`
        );
    }

    fs.mkdirSync(
        OUT_DIR,
        {
            recursive: true
        }
    );

    const tomTat: any[] = [];

    for (const n of SCENARIOS) {

        const datasetPath =
            path.resolve(
                DATASET_DIR,
                `dataset_n${n}.json`
            );

        const dataset =
            JSON.parse(
                fs.readFileSync(
                    datasetPath,
                    "utf8"
                )
            );

        if (dataset.merkle_depth !== MERKLE_DEPTH) {
            throw new Error(
                `dataset_n${n}.json ghi merkle_depth=${dataset.merkle_depth}, ` +
                `mach circom dung ${MERKLE_DEPTH}. Hai ben phai khop.`
            );
        }

        // ---------------------------------------------------------
        // Dung cay tu n commitment, dung thu tu trong dataset
        // ---------------------------------------------------------

        // -----------------------------------------------------------------
        // ⏱️ DO THOI GIAN DUNG CAY
        //
        // ✅ K10 (2026-09-03) — baseline DA DUNG QUY UOC MOI, khong phai sua:
        //    cay dung MOT LAN cho ca kich ban o day, ngoai vong lap sinh proof;
        //    trong vong lap chi goi getPath() — O(d).
        //
        //    Hai nhanh chinh nay cung vay: cay luu vao collection `merkleNodes`
        //    luc duyet root, moi luot rut chi doc `d` nut. ONC `witness_ms` tai
        //    n = 500 nho do tu 42 747,9 ms xuong 64,1 ms.
        //
        // ⇒ Cot `witness_ms` cua CA BA nhanh nay DEU KHONG gom buoc dung cay.
        //   Ranh gioi da khop. (Truoc K10 thi lech, va chu thich cu o day ghi
        //   dieu do — nay khong con dung.)
        //
        // Van do rieng tree_build_ms de con so ton tai va doi chieu duoc voi
        // chi phi dung cay cua hai nhanh kia.
        // -----------------------------------------------------------------

        const tCay =
            Date.now();

        const commitments: bigint[] = [];

        for (const sv of dataset.students) {

            commitments.push(
                await createCommitment(
                    sv.note.student_id,
                    sv.note.amount,
                    sv.note.rho
                )
            );
        }

        const tCommitment =
            Date.now() - tCay;

        const tDung =
            Date.now();

        const tree =
            new MerkleTree(
                MERKLE_DEPTH
            );

        await tree.insertAll(
            commitments
        );

        const treeBuildMs =
            Date.now() - tDung;

        const root =
            tree.root();

        // ---------------------------------------------------------
        // Mot input cho moi sinh vien
        // ---------------------------------------------------------

        const inputs: any[] = [];

        for (
            let i = 0;
            i < dataset.students.length;
            i++
        ) {
            const sv =
                dataset.students[i];

            const {
                siblings,
                directions
            } = tree.getPath(i);

            const nullifier =
                await createNullifier(
                    sv.note.rho
                );

            inputs.push({
                student_index: sv.student_index,
                address: sv.address,

                // circom nhan chuoi thap phan
                input: {
                    student_id: String(sv.note.student_id),
                    rho: String(sv.note.rho),
                    siblings: siblings.map(
                        (x: bigint) => x.toString()
                    ),
                    directions: directions.map(
                        (x: number) => String(x)
                    ),
                    root: root.toString(),
                    nullifier: nullifier.toString(),
                    amount: String(sv.note.amount),

                    // A25 — vi nhan, public input thu tu. Dia chi 20 byte doc
                    // nhu so nguyen big-endian, cung quy uoc voi hai nhanh kia.
                    recipient: BigInt(sv.address).toString()
                }
            });
        }

        const outPath =
            path.resolve(
                OUT_DIR,
                `inputs_n${n}.json`
            );

        fs.writeFileSync(
            outPath,
            JSON.stringify(
                {
                    n,
                    merkle_depth: MERKLE_DEPTH,
                    proof_system: "groth16 (circom/snarkjs)",
                    hash: "circomlib Poseidon — KHONG trung gia tri voi halo2_base sponge",
                    nguon_dataset: `zk-halo2-onchain/experiments/data/dataset_n${n}.json`,
                    root: root.toString(),

                    // Hai so nay CHUA duoc cong vao witness_ms cua
                    // performance CSV — xem ghi chu RANH GIOI o dau ham.
                    thoiGian: {
                        commitment_ms: tCommitment,
                        tree_build_ms: treeBuildMs,
                        ghiChu:
                            "Cay dung MOT LAN cho ca kich ban roi dung chung cho"
                            + " n sinh vien — dung quy uoc K10, giong hai nhanh"
                            + " chinh (chung luu cay vao merkleNodes luc duyet"
                            + " root, moi luot rut chi doc d nut). witness_ms cua"
                            + " ca ba nhanh deu KHONG gom buoc nay."
                    },

                    inputs
                },
                null,
                2
            )
        );

        tomTat.push({
            n,
            soSinhVien: inputs.length,
            root: root.toString(),
            file: path.relative(
                PROJECT_ROOT,
                outPath
            )
        });
    }

    // Quy uoc CLI cua hai repo: MOT object JSON tren stdout.
    console.log(
        JSON.stringify(
            {
                buoc: "prepareInputs",
                merkle_depth: MERKLE_DEPTH,
                kichBan: tomTat
            },
            null,
            2
        )
    );
}

main().catch(
    (error: any) => {
        console.error(error);
        process.exit(1);
    }
);
