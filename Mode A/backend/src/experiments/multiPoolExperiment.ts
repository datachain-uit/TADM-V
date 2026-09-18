/*
 * KỊCH BẢN 2 — NHIỀU POOL SONG SONG · nhánh OFF-CHAIN (ADV)
 *
 * Bản đối ứng với zk-halo2-onchain/backend/src/experiments/
 * multiPoolExperiment.ts. Cùng câu hỏi, cùng quy mô, cùng cách đọc kết
 * quả — chỉ khác ba chỗ ghi ở "KHÁC GÌ BẢN ONC" bên dưới.
 *
 * CÂU HỎI:
 * Day n = 1..100 chi do TRONG MOT POOL (toi da 512 sinh vien do
 * MERKLE_DEPTH = 9). No khong noi gi ve chuyen truong chay NHIEU chuong
 * trinh hoc bong song song — ma do moi la hinh dang that.
 *
 * Kich ban nay kiem dieu tu truoc toi nay moi chi la PHEP NHAN TREN GIAY:
 *
 *     du doan = 3 x deploy_pool + 3 x update_root + 45 x withdraw_gas
 *     do duoc = ?
 *     lech    = ?  %
 *
 * "Tinh cong" nghia la: chay 3 chuong trinh CUNG LUC co ton dung bang
 * tong 3 chuong trinh chay RIENG khong. Neu cac pool dung chung bo nho
 * (vi du mot so nullifier toan cuc) thi pool A se dat dan len vi pool B,
 * C cung ghi vao do — luc ay KHONG NHAN DUOC.
 *
 * ─────────────────────────────────────────────────────────────────────
 * KHÁC GÌ BẢN ONC — ba chỗ, đều do bản chất off-chain:
 *
 * 1. KHONG co verifier de deploy hay dung chung. Bo khang dinh
 *    "nhieu pool dung chung mot verifier".
 *
 * 2. `withdrawOffChain` KHONG nhan proof => KHONG co phep kiem am
 *    "proof hop le cua pool A gui vao pool B". Khong co proof de dat
 *    nham cho. Day la diem YEU HON that su cua nhanh nay, phai khai.
 *
 * 3. Van sinh proof va verify off-chain cho tung sinh vien — dung nhu
 *    flow that (createWithdrawalRequest + reviewWithdrawalRequest deu
 *    verify). Proof khong len chuoi, nhung `root` thi co.
 * ─────────────────────────────────────────────────────────────────────
 *
 * 🔴 CHI DOC `experiments/data/`. Dataset da dong bang — sinh lai la mat
 *    quyen noi "hai nhanh cung dau vao" cho TOAN BO phan dinh luong.
 *    File tam ghi sang results/, khong bao gio ghi vao data/.
 *
 * CHẠY:  npm run experiment:multipool
 * CẦN:   Ganache dung mnemonic dataset (xem DINH_NGHIA_PHEP_DO.md K0)
 *        + prover da build: cargo build --release -p prover
 *
 * ĐẶC TẢ: DINH_NGHIA_PHEP_DO.md muc 3d "Truc 3", menh de B; muc 3e buoc 3.
 */

/*
 * Tắt keepAlive — spawnSync trên prover chặn event loop đủ lâu để
 * Ganache đóng socket keep-alive, RPC kế tiếp dính ECONNRESET.
 */
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

const { runRust } = require("../clients/prover/halo2ProverClient");

const web3 = new Web3("http://127.0.0.1:8545");

// =========================
// PATHS
// =========================

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const DATA_DIR = path.resolve(PROJECT_ROOT, "experiments/data");
const RESULT_DIR = path.resolve(
    PROJECT_ROOT, "experiments/results/quantitative"
);
const MULTIPOOL_DIR = path.resolve(RESULT_DIR, "multipool");

const POOL_ARTIFACT = require(path.resolve(
    PROJECT_ROOT,
    "contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json"
));

// =========================
// CẤU HÌNH KỊCH BẢN
// =========================

/*
 * Ba chuong trinh hoc bong — GIONG HET ban ONC de hai nhanh so duoc.
 */
const PROGRAMS = [
    { name: "Hoc bong khoa CNTT", studentCount: 20 },
    { name: "Hoc bong khuyen khich", studentCount: 15 },
    { name: "Hoc bong vuot kho", studentCount: 10 }
];

const TOTAL_STUDENTS = PROGRAMS.reduce((a, c) => a + c.studentCount, 0);

// dataset_n50 co 50 sinh vien, du cho 45
const SOURCE_DATASET = path.resolve(DATA_DIR, "dataset_n50.json");

const FUNDING_PER_POOL = web3.utils.toWei("1", "ether");

function step(message: string) {
    process.stderr.write("  " + message + "\n");
}

// =========================
// RPC — bóc phong bì JSON-RPC
// =========================

async function callRpc(method: string, params: any[] = []): Promise<any> {
    const response: any = await (web3.currentProvider as any).request({
        method,
        params
    });

    return (
        response
        && typeof response === "object"
        && "result" in response
    )
        ? response.result
        : response;
}

// =========================
// CHỐT MÔI TRƯỜNG — K0
// =========================

async function assertMeasurementEnvironment(addresses: string[]) {
    const accounts: string[] = await web3.eth.getAccounts();

    const accountSet = new Set(
        accounts.map((a: string) => a.toLowerCase())
    );

    const missing = addresses.filter(
        (addr: string) => !accountSet.has(addr.toLowerCase())
    );

    if (missing.length > 0) {
        throw new Error(
            [
                "GANACHE MNEMONIC MISMATCH: "
                + missing.length + "/" + addresses.length
                + " dataset wallets are not Ganache accounts.",
                "First mismatching wallet: " + missing[0],
                "Running on would measure the WRONG system: every withdrawal"
                + " would cost an extra 25 000 gas for EIP-161 account"
                + " creation, making the numbers incomparable with the"
                + " n-sweep results.",
                "Fix: restart Ganache with:",
                "  ganache --wallet.mnemonic \"test test test test test"
                + " test test test test test test junk\""
                + " --wallet.totalAccounts 120"
            ].join("\n")
        );
    }

    console.error(
        `[K0] ${addresses.length}/${addresses.length} wallets are `
        + "Ganache accounts - PASS"
    );
}

// =========================
// CHIA DATASET
// =========================

function splitDataset() {
    const source = JSON.parse(fs.readFileSync(SOURCE_DATASET, "utf8"));

    if (!Array.isArray(source.students)) {
        throw new Error("dataset_n50.json has no `students` array");
    }

    if (source.students.length < TOTAL_STUDENTS) {
        throw new Error(
            `Need ${TOTAL_STUDENTS} students, dataset only has `
            + source.students.length
        );
    }

    if (!fs.existsSync(MULTIPOOL_DIR)) {
        fs.mkdirSync(MULTIPOOL_DIR, { recursive: true });
    }

    const result: any[] = [];
    let offset = 0;

    for (const program of PROGRAMS) {
        const groupStudents = source.students.slice(
            offset, offset + program.studentCount
        );
        offset += program.studentCount;

        result.push({ ...program, students: groupStudents });
    }

    console.error(
        `[split] ${TOTAL_STUDENTS} students -> `
        + PROGRAMS.map((c) => c.studentCount).join(" + ")
    );

    return result;
}

// =========================
// SINH PROOF THEO TỪNG POOL
// =========================

/*
 * Moi chuong trinh dung CAY RIENG => root rieng. Chi so la Merkle danh
 * lai tu 0 trong pham vi tung nhom, dung nhu approveRootService lam
 * (`find({ pool: pool._id })` roi kiem merkleIndex lien tuc tu 0).
 */
function generateProofs(programs: any[]) {
    for (const program of programs) {
        console.error(
            `\n[proof] ${program.name} - ${program.studentCount} students ...`
        );

        // 1. commitment cho ca nhom — can du truoc khi sinh proof
        const commitments: string[] = program.students.map(
            (sv: any) => runRust("commitment", {
                student_id: sv.note.student_id,
                amount: String(sv.note.amount),
                rho: String(sv.note.rho)
            }).commitment
        );

        // V4 — giu lai de cong bo cung luc voi root o buoc duyet.
        program.commitments = commitments;

        // 2. proof cho tung sinh vien, merkle_index trong pham vi NHOM
        const proofs: any[] = [];

        for (let i = 0; i < program.students.length; i++) {
            const sv = program.students[i];

            step(`proof ${i + 1}/${program.studentCount}`);

            const proof = runRust("prove", {
                student_id: sv.note.student_id,
                amount: String(sv.note.amount),
                rho: String(sv.note.rho),
                commitments,
                merkle_index: i,
                recipient: sv.address
            });

            /*
             * Verify off-chain — dung nhu flow that. Hop dong khong kiem
             * proof, nhung backend thi co (hai lan: luc tao yeu cau va
             * luc duyet rut).
             */
            const verification = runRust("verify", {
                proof: proof.proof,
                root: proof.root,
                nullifier: proof.nullifier,
                amount: proof.amount,
                recipient: proof.recipient
            });

            if (!verification.verified) {
                throw new Error(
                    `${program.name}: proof ${i} failed off-chain verification`
                );
            }

            proofs.push({
                student_index: i,
                address: sv.address,
                amountWei: String(sv.note.amount),
                root: proof.root,
                nullifier: proof.nullifier
            });
        }

        program.proofs = proofs;
        program.root = proofs[0].root;

        /*
         * Moi proof trong MOT pool phai co chung root — cung mot cay.
         * Lech nghia la chi so Merkle bi danh sai.
         */
        for (const p of proofs) {
            if (p.root !== program.root) {
                throw new Error(
                    `${program.name}: proofs disagree on root - `
                    + "Merkle index numbering is wrong"
                );
            }
        }
    }

    /*
     * Ba pool PHAI co ba root KHAC NHAU. Trung nhau thi phep kiem
     * "moi pool chi cong bo root cua minh" tro nen vo nghia.
     */
    const roots = programs.map((p: any) => p.root);
    if (new Set(roots).size !== roots.length) {
        throw new Error(
            "Two programs produced the same Merkle root - the isolation "
            + "check would be meaningless"
        );
    }
}

// =========================
// DEPLOY
// =========================

async function deployPool(from: string, value: string) {
    const contract = new web3.eth.Contract(POOL_ARTIFACT.abi);

    const deployTx = contract.deploy({
        data: POOL_ARTIFACT.bytecode,
        // V1(b) — 0 = khong cuong che menh gia (dataset nhieu muc tien).
        arguments: ["0"]
    });

    const estimate = await deployTx.estimateGas({ from, value });

    let receipt: any = null;

    const instance = await deployTx
        .send({ from, value, gas: Number(estimate) + 1000000 })
        .on("receipt", (r: any) => {
            receipt = r;
        });

    return {
        instance,
        address: instance.options.address,
        gasUsed: Number(receipt.gasUsed)
    };
}

// =========================
// DỰ ĐOÁN TỪ ĐƠN GIÁ
// =========================

/*
 * Doc don gia da do o kich ban 1 roi nhan theo cong thuc. Day la con so
 * PHAI doi chieu voi so do duoc — do la diem chinh cua kich ban nay.
 */
function predictFromUnitCosts() {
    const file = path.resolve(RESULT_DIR, "gas_offchain_raw.csv");

    if (!fs.existsSync(file)) {
        return null;
    }

    const lines = String(fs.readFileSync(file, "utf8"))
        .split("\n")
        .filter((l: string) => l.trim().length > 0);

    if (lines.length < 2) {
        return null;
    }

    const columns = String(lines[0]).split(",");

    function mean(name: string) {
        const i = columns.indexOf(name);
        if (i < 0) {
            return null;
        }

        const values: number[] = [];

        for (let k = 1; k < lines.length; k++) {
            const raw = String(lines[k]).split(",")[i];
            const v = Number(raw);
            if (raw !== undefined && raw !== "" && Number.isFinite(v) && v > 0) {
                values.push(v);
            }
        }

        return values.length === 0
            ? null
            : values.reduce((a, b) => a + b, 0) / values.length;
    }

    const withdraw = mean("withdraw_gas");
    const pool = mean("deploy_pool_gas");
    const root = mean("update_root_gas");

    if (withdraw === null || pool === null || root === null) {
        return null;
    }

    return {
        withdraw_gas: withdraw,
        deploy_pool_gas: pool,
        update_root_gas: root,
        /*
         * KHONG co deploy_verifier_gas — ADV khong co verifier contract.
         * Do la O TRONG, khong phai 0 (spec muc 5.3).
         */
        deploy_verifier_gas: null,
        total:
            PROGRAMS.length * pool
            + PROGRAMS.length * root
            + TOTAL_STUDENTS * withdraw
    };
}

// =========================
// MAIN
// =========================

async function main() {
    console.error("=".repeat(64));
    console.error("SCENARIO 2 - MULTIPLE POOLS IN PARALLEL (OFF-CHAIN)");
    console.error("=".repeat(64));

    const programs = splitDataset();
    generateProofs(programs);

    const allAddresses: string[] = [];
    for (const program of programs) {
        for (const sv of program.students) {
            allAddresses.push(sv.address);
        }
    }

    await assertMeasurementEnvironment(allAddresses);

    const accounts: string[] = await web3.eth.getAccounts();

    if (accounts.length === 0) {
        throw new Error("Ganache returned no accounts");
    }

    const school: string = String(accounts[0]);

    /*
     * `RUN_MODE` — nhan cho luot chay, ghi vao cot `run_mode` cua CSV.
     * Giu KHOP voi ONC `multiPoolExperiment.ts` (them 2026-08-30).
     *
     * `serial`   : ca ba pool ky bang accounts[0], `await` lan luot (HIEN TAI)
     * `parallel` : moi pool MOT VI RIENG, gui bang Promise.all (CHUA CAI DAT)
     *
     * 🔴 Chua cai dat `parallel` vi Ganache mac dinh INSTAMINE — dao ngay
     * mot block cho MOI giao dich. Da do that 2026-08-30: 3 giao dich tu 3
     * vi khac nhau gui bang Promise.all van ra 3 block rieng. O che do do
     * `block_span` LUON bang so giao dich, nen con so thu duoc la TAO TAC
     * CUA GANACHE chu khong phai tinh chat he thong. Muon do that phai chay
     * Ganache voi `--miner.blockTime 2`.
     */
    const RUN_MODE: string = "serial";

    const snapshotId = await callRpc("evm_snapshot", []);
    console.error(`[chain] snapshot ${snapshotId}`);

    const csvLines: string[] = [
        "pool_index,program,student_count,student_index,withdraw_order,"
        + "withdraw_gas,withdraw_ms,root,nullifier,"
        + "school_account,block_number,run_mode"
    ];

    let measuredTotal = 0;

    try {
        // ---- 1. ba pool (ADV khong co verifier de deploy) ----
        for (let i = 0; i < programs.length; i++) {
            const program = programs[i];

            const pool = await deployPool(school, FUNDING_PER_POOL);

            program.pool = pool.instance;
            program.poolAddress = pool.address;
            measuredTotal += pool.gasUsed;

            console.error(
                `[deploy] ${program.name}: `
                + `${pool.gasUsed.toLocaleString("en-US")} gas`
            );
        }

        // ---- 2. duyet root tung pool ----
        for (const program of programs) {
            // V4 — cong bo ca tap commitment cua chinh pool nay.
            const receipt = await program.pool.methods
                .updateRoot(program.root, program.commitments ?? [])
                .send({ from: school, gas: 800000 });

            measuredTotal += Number(receipt.gasUsed);

            console.error(
                `[root] ${program.name}: `
                + `${Number(receipt.gasUsed).toLocaleString("en-US")} gas`
            );
        }

        // ---- 3. moi pool chi biet root CUA MINH ----
        for (let a = 0; a < programs.length; a++) {
            for (let b = 0; b < programs.length; b++) {
                const known = await programs[a].pool.methods
                    .validRoot(programs[b].root)
                    .call();

                const expected = a === b;

                if (Boolean(known) !== expected) {
                    throw new Error(
                        `Pool isolation FAILED: pool ${a} `
                        + (expected ? "does not know" : "knows")
                        + ` root of pool ${b}`
                    );
                }
            }
        }

        console.error("[isolation] each pool knows only its own root - PASS");

        /*
         * ---- 4. RUT XEN KE ----
         *
         * A[0] -> B[0] -> C[0] -> A[1] -> ...
         *
         * Ba pool phai CUNG DANG SONG. Chay xong han pool A roi moi mo B
         * thi khong kiem duoc gi — luc B chay thi A da dong so.
         */
        const largestProgram = Math.max(
            ...programs.map((c: any) => c.studentCount)
        );

        let order = 0;

        console.error("\n[withdraw] interleaving three pools ...");

        for (let i = 0; i < largestProgram; i++) {
            for (let k = 0; k < programs.length; k++) {
                const program = programs[k];

                if (i >= program.studentCount) {
                    continue;
                }

                const p = program.proofs[i];

                /*
                 * amount lay TU PROOF, khong dung hang so. Hop dong ADV
                 * khong kiem proof nen se KHONG revert neu sai — no se
                 * lang le chi sai so tien. Im lang con te hon revert.
                 */
                const t0 = performance.now();

                const receipt = await program.pool.methods
                    .withdrawOffChain(
                        p.root,
                        p.nullifier,
                        p.address,
                        p.amountWei
                    )
                    .send({ from: school, gas: 500000 });

                const ms = performance.now() - t0;
                const gas = Number(receipt.gasUsed);

                measuredTotal += gas;
                order++;

                csvLines.push([
                    k,
                    `"${program.name}"`,
                    program.studentCount,
                    i,
                    order,
                    gas,
                    ms.toFixed(2),
                    p.root,
                    p.nullifier,
                    school,
                    Number(receipt.blockNumber),
                    RUN_MODE
                ].join(","));
            }
        }

        console.error(`[withdraw] done, ${order} withdrawals`);

        // ---- 5. nullifier cua pool nay KHONG chan pool kia ----
        const crossChecks: any[] = [];

        for (let a = 0; a < programs.length; a++) {
            for (let b = 0; b < programs.length; b++) {
                if (a === b) {
                    continue;
                }

                const used = await programs[a].pool.methods
                    .usedNullifier(programs[b].proofs[0].nullifier)
                    .call();

                crossChecks.push({ pool: a, nullifier_of_pool: b, used });

                if (Boolean(used)) {
                    throw new Error(
                        `Nullifier isolation FAILED: pool ${a} sees `
                        + `nullifier of pool ${b}`
                    );
                }
            }
        }

        console.error(
            "[isolation] nullifier ledgers are separate - PASS"
        );

        // ---- 6. ghi CSV ----
        fs.writeFileSync(
            path.resolve(MULTIPOOL_DIR, "multipool_raw.csv"),
            csvLines.join("\n") + "\n"
        );

        // ---- 7. DOI CHIEU du doan vs do duoc ----
        const predicted = predictFromUnitCosts();

        const summary: any = {
            /*
             * 🔴 Khoi nay BAT BUOC di kem so lieu. So khong kem "chung
             * minh duoc gi" thi nguoi viet bai phai tra nguoc sang spec
             * — va do la luc trich sai.
             */
            contribution2: {
                question:
                    "Experimental evaluation of the trade-off between "
                    + "on-chain and off-chain verification in terms of cost, "
                    + "deployability and scalability "
                    + "(00_contributions.md lines 43-44)",
                axis: "SCALABILITY - proposition B",
                what_it_proves:
                    "The n-sweep only measures WITHIN ONE POOL, at most 512 "
                    + "students (MERKLE_DEPTH = 9). This scenario proves that "
                    + "going past 512 by ADDING POOLS is valid: the total "
                    + "cost equals the sum of the parts, with no cross-pool "
                    + "cost. => cost is linear in the total number of "
                    + "students, with NO ceiling on scale.",
                turns_the_formula_from:
                    "ASSUMPTION (arithmetic on paper) -> VERIFIED (measured)",
                what_it_does_not_prove:
                    "Says NOTHING about cheap vs expensive - that is the COST "
                    + "axis. Says NOTHING about mainnet - Ganache does not "
                    + "represent gas price or network congestion.",
                weaker_than_onchain:
                    "This branch has NO negative test 'a VALID proof from "
                    + "pool A rejected by pool B' - withdrawOffChain takes no "
                    + "proof, so there is no proof to misplace. Isolation "
                    + "here rests on validRoot and usedNullifier only, which "
                    + "the university itself supplies. ADV blocks MISTAKES; "
                    + "ONC blocks MALICE too.",
                sentence_allowed:
                    "The pools are independent, so a program with more than "
                    + "512 students can be split across several pools without "
                    + "them affecting each other; cost ADDS UP rather than "
                    + "multiplying.",
                sentence_forbidden:
                    "'Scales without limit' - a program over 512 students "
                    + "MUST be split across pools: one administrative list "
                    + "becomes two roots and two approval rounds. That is a "
                    + "real operational burden and must be stated."
            },

            scenario: "multipool (SCENARIO 2) - off-chain",
            program: PROGRAMS.map((c) => ({
                name: c.name,
                student_count: c.studentCount
            })),
            total_students: TOTAL_STUDENTS,
            pool_count: PROGRAMS.length,
            shared_verifier: null,
            shared_verifier_note:
                "ADV has no verifier contract - this assertion does not "
                + "apply to the off-chain branch",
            interleaved_withdrawals: true,
            root_isolation_verified: true,
            nullifier_isolation_verified: true,
            cross_checks: crossChecks,
            total_gas_measured: measuredTotal
        };

        console.error("\n" + "=".repeat(64));
        console.error("RESULT");
        console.error("=".repeat(64));
        console.error(
            `total gas MEASURED  : ${measuredTotal.toLocaleString("en-US")}`
        );

        if (predicted) {
            const diff = measuredTotal - predicted.total;
            const percent = (diff / predicted.total) * 100;

            summary.unit_costs_from_scenario1 = predicted;
            summary.total_gas_predicted = Math.round(predicted.total);
            summary.diff_absolute = Math.round(diff);
            summary.diff_percent = Math.round(percent * 1000) / 1000;
            summary.verdict =
                Math.abs(percent) < 1
                    ? "ADDITIVE FORMULA HOLDS - difference under 1%"
                    : "SIGNIFICANT DEVIATION - investigate before using "
                        + "these numbers";

            console.error(
                `total gas PREDICTED : `
                + `${Math.round(predicted.total).toLocaleString("en-US")}`
            );
            console.error(
                `difference          : `
                + `${Math.round(diff).toLocaleString("en-US")}`
                + ` (${percent.toFixed(3)} %)`
            );
            console.error(`=> ${summary.verdict}`);
        } else {
            summary.note =
                "gas_offchain_raw.csv missing, cannot cross-check. "
                + "Run `npm run experiment:quantitative` first.";
            console.error(
                "\n⚠️  gas_offchain_raw.csv missing - cannot cross-check"
            );
        }

        fs.writeFileSync(
            path.resolve(MULTIPOOL_DIR, "multipool_summary.json"),
            JSON.stringify(summary, null, 2)
        );

        console.error(`\nWritten: ${MULTIPOOL_DIR}`);
    } finally {
        await callRpc("evm_revert", [snapshotId]);
        console.error(`[chain] revert ${snapshotId}`);
    }
}

main().catch((e: any) => {
    console.error("\n🔴 FAILED:", e && e.message ? e.message : e);
    process.exit(1);
});
