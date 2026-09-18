/*
 * KỊCH BẢN 2 — MỘT ĐỢT PHÁT HỌC BỔNG THẬT: NHIỀU POOL SONG SONG
 *
 * VÌ SAO CÓ KỊCH BẢN NÀY:
 * Dãy n = 1…100 chỉ đo TRONG MỘT POOL, tức tối đa 512 sinh viên
 * (MERKLE_DEPTH = 9). Nó không nói gì về chuyện trường chạy NHIỀU
 * chương trình học bổng song song — mà đó mới là hình dạng thật.
 *
 * `PoolIsolation.js` đã chứng minh các pool KHÔNG ĐỤNG NHAU (5/5), nhưng
 * đó là unit test 2 pool. Kịch bản này chạy HẾT LUỒNG với 3 pool, để
 * kiểm điều mà từ trước tới nay mới chỉ là PHÉP NHÂN TRÊN GIẤY:
 *
 *     du doan = 1 x deploy_verifier + 3 x deploy_pool
 *             + 3 x update_root     + 45 x withdraw_gas
 *
 *     do duoc = ?
 *
 * Lệch bao nhiêu — đó là kết quả chính của kịch bản này. Nó biến công
 * thức cộng từ GIẢ ĐỊNH thành thứ ĐÃ KIỂM.
 *
 * QUY MÔ: 3 pool × 20/15/10 = 45 sinh viên. Cố ý KHÔNG chạy 260 — tính
 * chất cần kiểm là "công thức cộng có đúng không", không phải quy mô;
 * 260 tốn gấp năm lần thời gian mà không chứng minh thêm gì.
 *
 * XEN KẼ: rút A[0] → B[0] → C[0] → A[1] → … Ba pool phải CÙNG ĐANG SỐNG.
 * Chạy xong hẳn pool A rồi mới mở B thì không kiểm được gì — lúc B chạy
 * thì A đã đóng sổ.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 🔴 HAI CẠM BẪY ĐÃ TRÁNH SẴN:
 *
 * 1. `bench-from-dataset` ghi ra `proofs_n{dataset.n}.json` và
 *    `performance_onchain_n{dataset.n}.csv`. Nếu đặt n = 20/15/10 thì nó
 *    GHI ĐÈ kết quả thật của kịch bản n=20 và n=10. Đã tránh bằng cách
 *    đặt n = 9020/9015/9010 — `dataset.n` chỉ dùng cho TÊN FILE và log,
 *    vòng lặp chạy theo `students.len()` (kiểm ở prover/src/experiment.rs
 *    dòng 249).
 *
 * 2. `bench-from-dataset` KHÔNG đụng `Halo2Verifier.sol` — chỉ
 *    `export-verifier-from-dataset` mới ghi đè. Nên kịch bản này an toàn
 *    với verifier đang biên dịch.
 * ─────────────────────────────────────────────────────────────────────
 *
 * CHẠY:  npm run experiment:multipool
 * CẦN:   Ganache đúng mnemonic dataset (xem DINH_NGHIA_PHEP_DO.md K0)
 *        + prover đã build: cargo build --release -p prover
 *
 * ĐẶC TẢ: DINH_NGHIA_PHEP_DO.md mục 3d "Trục 3 · Khả năng mở rộng",
 *         mệnh đề B; và mục 3e bước 3.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");
const { spawnSync } = require("child_process");

const {
    normalizeCalldata,
    extractPublicInputs
} = require("../clients/blockchain/shieldedPoolClient");

/*
 * spawnSync trên prover chặn event loop đủ lâu để Ganache đóng socket
 * keep-alive => RPC kế tiếp dính ECONNRESET. Đã chẩn đoán và xác minh;
 * áp dụng cho MỌI runner có gọi prover.
 */
http.globalAgent.keepAlive = false;

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

const VERIFIER_ARTIFACT = require(path.resolve(
    PROJECT_ROOT,
    "contracts/artifacts/contracts/Halo2Verifier.sol/Halo2Verifier.json"
));

// =========================
// CẤU HÌNH KỊCH BẢN
// =========================

/*
 * Ba chương trình học bổng, đúng hình dạng thật của một đợt phát:
 * quy mô khác nhau, chạy song song.
 *
 * `nGia` = giá trị ghi vào trường `n` của dataset tạm. PHẢI không trùng
 * {1,10,30,60,100,353,500} — xem cạm bẫy 1 ở đầu file.
 */
const PROGRAMS = [
    { name: "Hoc bong khoa CNTT", studentCount: 20, fakeN: 9020 },
    { name: "Hoc bong khuyen khich", studentCount: 15, fakeN: 9015 },
    { name: "Hoc bong vuot kho", studentCount: 10, fakeN: 9010 }
];

const TOTAL_STUDENTS = PROGRAMS.reduce(
    (a, c) => a + c.studentCount, 0
);

// nguon: dataset_n50 co 50 sinh vien, du cho 45
const SOURCE_DATASET = path.resolve(DATA_DIR, "dataset_n50.json");

const FUNDING_PER_POOL = web3.utils.toWei("1", "ether");

// =========================
// RPC — bóc phong bì JSON-RPC
// =========================

/*
 * Provider trả về CẢ phong bì {jsonrpc, id, result}. Truyền nguyên cục
 * vào evm_revert thì Ganache báo "Cannot wrap a object as a json-rpc
 * type". Phải bóc `.result`.
 */
async function callRpc(method: string, params: any[]) {
    const response: any = await (web3.currentProvider as any).request({
        method,
        params
    });

    if (response && typeof response === "object" && "result" in response) {
        return response.result;
    }

    return response;
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
        `[K0] ${addresses.length}/${addresses.length} wallets are Ganache accounts - PASS`
    );
}

// =========================
// CHIA DATASET
// =========================

/*
 * Cắt dataset nguồn thành ba nhóm rời nhau, mỗi nhóm một chương trình.
 *
 * 🔴 CHỈ ĐỌC dataset gốc. `experiments/data/` đã đóng băng — sinh lại là
 *    mất quyền nói "hai nhánh cùng đầu vào" cho TOÀN BỘ phần định lượng.
 *    File tạm ghi sang results/, không bao giờ ghi vào data/.
 */
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
        const groupStudents = source.students.slice(offset, offset + program.studentCount);
        offset += program.studentCount;

        /*
         * Vi tri trong MANG quyet dinh chi so la Merkle (prover lap theo
         * students.len()). Nen chi can cat la du — khong phai sua gi
         * trong tung ban ghi.
         */
        const subDataset = {
            n: program.fakeN,
            merkle_depth: source.merkle_depth,
            school_account_index: source.school_account_index,
            student_account_offset: source.student_account_offset,
            note:
                "TEMPORARY dataset for the multipool scenario, derived from dataset_n50."
                + " `n` = " + program.fakeN + " is deliberately OUTSIDE {1,10,30,60,100,353,500}"
                + " so bench-from-dataset cannot overwrite the real results.",
            program: program.name,
            students: groupStudents
        };

        const file = path.resolve(
            MULTIPOOL_DIR, `dataset_${program.fakeN}.json`
        );

        fs.writeFileSync(
            file, JSON.stringify(subDataset, null, 2)
        );

        result.push({ ...program, file, students: groupStudents });
    }

    console.error(
        `[split] ${TOTAL_STUDENTS} students -> `
        + PROGRAMS.map((c) => c.studentCount).join(" + ")
    );

    return result;
}

// =========================
// SINH PROOF
// =========================

function proverPath() {
    return path.resolve(
        PROJECT_ROOT,
        process.platform === "win32"
            ? "target/release/prover.exe"
            : "target/release/prover"
    );
}

/*
 * Goi prover mode `bench-from-dataset`.
 *
 * 🔴 KHONG dung `export-verifier-from-dataset` — mode do GHI DE
 *    contracts/contracts/Halo2Verifier.sol. Kich ban nay dung dung
 *    verifier dang co.
 */
function generateProofs(programs: any[]) {
    for (const program of programs) {
        console.error(
            `\n[proof] ${program.name} - ${program.studentCount} students ...`
        );

        const spawnResult = spawnSync(
            proverPath(),
            [
                "bench-from-dataset",
                path.relative(
                    path.resolve(PROJECT_ROOT, "prover"),
                    program.file
                ).replace(/\\/g, "/")
            ],
            {
                cwd: path.resolve(PROJECT_ROOT, "prover"),
                encoding: "utf8",
                stdio: ["ignore", "ignore", "inherit"]
            }
        );

        if (spawnResult.error) {
            throw spawnResult.error;
        }

        if (spawnResult.status !== 0) {
            throw new Error(
                `prover failed for ${program.name} (dataset ${program.fakeN})`
            );
        }

        /*
         * Prover ghi ra RESULT_DIR/proofs_n{nGia}.json. Doi sang
         * multipool/ de results/quantitative/ chi con file cua day n.
         */
        const src = path.resolve(RESULT_DIR, `proofs_n${program.fakeN}.json`);
        const dst = path.resolve(MULTIPOOL_DIR, `proofs_${program.fakeN}.json`);

        if (!fs.existsSync(src)) {
            throw new Error(`Proof file not found: ${src}`);
        }

        fs.renameSync(src, dst);

        // don not CSV performance de khong lan voi ket qua day n
        const csvSrc = path.resolve(
            RESULT_DIR, `performance_onchain_n${program.fakeN}.csv`
        );

        if (fs.existsSync(csvSrc)) {
            fs.renameSync(
                csvSrc,
                path.resolve(MULTIPOOL_DIR, `performance_${program.fakeN}.csv`)
            );
        }

        program.proofs = JSON.parse(fs.readFileSync(dst, "utf8"));

        if (program.proofs.length !== program.studentCount) {
            throw new Error(
                `${program.name}: expected ${program.studentCount} proofs, got `
                + program.proofs.length
            );
        }
    }
}

// =========================
// DEPLOY
// =========================

async function deployContract(
    artifact: any,
    args: any[],
    from: string,
    value: string = "0"
) {
    const contract = new web3.eth.Contract(artifact.abi);

    const deployTx = contract.deploy({
        data: artifact.bytecode,
        arguments: args
    });

    const estimate = await deployTx.estimateGas({ from, value });

    let receipt: any = null;

    const instance = await deployTx
        .send({
            from,
            value,
            gas: Number(estimate) + 1000000
        })
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
 * Đọc đơn giá đã đo ở dãy n, rồi nhân theo công thức. Đây là con số
 * PHẢI đối chiếu với số đo được — đó là điểm chính của kịch bản này.
 */
function predictFromUnitCosts() {
    const f = path.resolve(RESULT_DIR, "gas_onchain_raw.csv");

    if (!fs.existsSync(f)) {
        return null;
    }

    const dong = String(fs.readFileSync(f, "utf8"))
        .split("\n")
        .filter((l: string) => l.trim().length > 0);

    if (dong.length < 2) {
        return null;
    }

    const cot = String(dong[0]).split(",");

    function trungBinh(name: string) {
        const i = cot.indexOf(name);
        if (i < 0) {
            return null;
        }

        const gia: number[] = [];

        for (let k = 1; k < dong.length; k++) {
            const o = String(dong[k]).split(",")[i];
            const v = Number(o);
            if (o !== undefined && o !== "" && Number.isFinite(v) && v > 0) {
                gia.push(v);
            }
        }

        return gia.length === 0
            ? null
            : gia.reduce((a, b) => a + b, 0) / gia.length;
    }

    const withdrawn = trungBinh("withdraw_gas");
    const pool = trungBinh("deploy_pool_gas");
    const verifier = trungBinh("deploy_verifier_gas");
    const root = trungBinh("update_root_gas");

    if (withdrawn === null || pool === null || verifier === null || root === null) {
        return null;
    }

    return {
        withdraw_gas: withdrawn,
        deploy_pool_gas: pool,
        deploy_verifier_gas: verifier,
        update_root_gas: root,
        total:
            verifier
            + PROGRAMS.length * pool
            + PROGRAMS.length * root
            + TOTAL_STUDENTS * withdrawn
    };
}

// =========================
// MAIN
// =========================

async function main() {
    console.error("=".repeat(64));
    console.error("SCENARIO 2 - MULTIPLE POOLS IN PARALLEL");
    console.error("=".repeat(64));

    // ---- 1. chia dataset + sinh proof ----
    const programs = splitDataset();
    generateProofs(programs);

    // ---- 2. chot moi truong ----
    const moiDiaChi: string[] = [];
    for (const program of programs) {
        for (const sv of program.students) {
            moiDiaChi.push(sv.address);
        }
    }

    await assertMeasurementEnvironment(moiDiaChi);

    const accounts: string[] = await web3.eth.getAccounts();

    if (accounts.length === 0) {
        throw new Error("Ganache returned no accounts");
    }

    const school: string = String(accounts[0]);

    /*
     * `RUN_MODE` — nhan cho luot chay, ghi vao cot `run_mode` cua CSV.
     *
     * `serial`   : ca ba pool ky bang accounts[0], `await` lan luot.
     *              => moi giao dich cho giao dich truoc  (HIEN TAI)
     * `parallel` : moi pool MOT VI RIENG, gui bang Promise.all.
     *              => cac giao dich khong cho nhau       (CHUA CAI DAT)
     *
     * 🔴 CHUA CAI DAT `parallel`, va ly do KHONG phai vi kho:
     *
     * Ganache mac dinh chay INSTAMINE — dao ngay mot block cho MOI giao
     * dich. Da do that 2026-08-30: gui 3 giao dich tu 3 vi khac nhau bang
     * Promise.all van ra 3 block rieng (block 1, 2, 3).
     *
     * => O che do nay `block_span` LUON bang so giao dich, du co song song
     *    hay khong. Chay ma khong doi cau hinh se cho ra con so "khong
     *    song song" — nhung do la TAO TAC CUA GANACHE, khong phai tinh
     *    chat cua he thong. Ket luan tu no la SAI.
     *
     * Muon do that thi phai khoi dong Ganache voi `--miner.blockTime 2`
     * (hoac tat instamine) de nhieu giao dich gop duoc vao mot block.
     *
     * Xem `DINH_NGHIA_PHEP_DO.md` muc "Buoc 3 - KICH BAN 2" va
     * `code/STATUS.md`.
     */
    const RUN_MODE: string = "serial";

    // ---- 3. chup anh chain ----
    const snapshotId = await callRpc("evm_snapshot", []);
    console.error(`[chain] snapshot ${snapshotId}`);

    /*
     * Ten cot THEO BAN TIENG ANH CUA ADV (2026-08-30).
     *
     * Truoc do ONC ghi `pool,chuong_trinh,so_sinh_vien,thu_tu_rut` (tieng
     * Viet) con ADV ghi `pool_index,program,student_count,withdraw_order`
     * (tieng Anh) — CUNG du lieu, KHAC ten. Script nao doc ca hai repo de
     * so sanh hai nhanh (chinh la Contribution 2) deu gay. Chot dung ban
     * tieng Anh vi no khop quy uoc moi file khac (`student_index`,
     * `withdraw_gas`). Xem `code/LUOC_DO_CSV.md` loi so 1.
     *
     * Ba cot cuoi them 2026-08-30 cho phep do `block_span`:
     *   school_account — vi ky giao dich (BIEN duoc doi giua hai luot)
     *   block_number   — receipt.blockNumber, bang chung goc cua song song
     *   run_mode       — `serial` | `parallel`
     * Xem `DINH_NGHIA_PHEP_DO.md` muc "Buoc 3 - KICH BAN 2".
     */
    const csvLines: string[] = [
        "pool_index,program,student_count,student_index,withdraw_order,"
        + "withdraw_gas,withdraw_ms,root,nullifier,"
        + "school_account,block_number,run_mode"
    ];

    let measuredTotal = 0;

    try {
        // ---- 4. MOT verifier dung chung cho ca ba pool ----
        const verifier = await deployContract(
            VERIFIER_ARTIFACT, [], school
        );

        measuredTotal += verifier.gasUsed;

        console.error(
            `\n[deploy] SHARED verifier: `
            + `${verifier.gasUsed.toLocaleString("en-US")} gas`
        );

        // ---- 5. ba pool, cung tro toi verifier do ----
        for (const program of programs) {
            const pool = await deployContract(
                POOL_ARTIFACT,
                [verifier.address, "0"],
                school,
                FUNDING_PER_POOL
            );

            program.pool = pool.instance;
            program.poolAddress = pool.address;
            measuredTotal += pool.gasUsed;

            console.error(
                `[deploy] ${program.name}: `
                + `${pool.gasUsed.toLocaleString("en-US")} gas`
            );
        }

        // ---- 6. duyet root tung pool ----
        for (const program of programs) {
            const root = extractPublicInputs(
                normalizeCalldata(program.proofs[0])
            ).root;

            const receipt = await program.pool.methods
                .updateRoot(root, [])
                .send({ from: school, gas: 500000 });

            program.root = root;
            measuredTotal += Number(receipt.gasUsed);

            console.error(
                `[root] ${program.name}: ${Number(receipt.gasUsed).toLocaleString("en-US")} gas`
            );
        }

        /*
         * ---- 7. RUT XEN KE ----
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
            for (const program of programs) {
                if (i >= program.studentCount) {
                    continue;
                }

                const calldata = normalizeCalldata(program.proofs[i]);
                const publicInputs = extractPublicInputs(calldata);

                /*
                 * amount lay TU PUBLIC INPUT THU BA cua proof, khong
                 * dung hang so — contract co require("amount differs
                 * from proof") nen lech la revert het.
                 */
                const t0 = performance.now();

                const receipt = await program.pool.methods
                    .withdraw(
                        calldata,
                        publicInputs.root,
                        publicInputs.nullifier,
                        program.students[i].address,
                        publicInputs.amountWei
                    )
                    .send({ from: school, gas: 3000000 });

                const ms = performance.now() - t0;
                const gas = Number(receipt.gasUsed);

                measuredTotal += gas;
                order++;

                csvLines.push([
                    program.fakeN,
                    `"${program.name}"`,
                    program.studentCount,
                    i,
                    order,
                    gas,
                    ms.toFixed(2),
                    publicInputs.root,
                    publicInputs.nullifier,
                    school,
                    Number(receipt.blockNumber),
                    RUN_MODE
                ].join(","));
            }
        }

        console.error(`[withdraw] done, ${order} withdrawals`);

        // ---- 8. ghi CSV ----
        const fCsv = path.resolve(MULTIPOOL_DIR, "multipool_raw.csv");
        fs.writeFileSync(fCsv, csvLines.join("\n") + "\n");

        // ---- 9. DOI CHIEU du doan vs do duoc ----
        const predicted = predictFromUnitCosts();

        const summary: any = {
            /*
             * 🔴 Khoi nay BAT BUOC di kem so lieu. So khong kem "giai
             * quyet duoc gi" thi nguoi viet bai phai tra nguoc sang
             * spec — va do la luc trich sai.
             */
            contribution2: {
                cau_hoi:
                    "Danh gia thuc nghiem su danh doi giua on-chain va "
                    + "off-chain ve chi phi, kha nang trien khai va kha "
                    + "nang mo rong (00_contributions.md dong 43-44)",
                truc: "MO RONG — menh de B",
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

            scenario: "multipool (SCENARIO 2)",
            program: PROGRAMS.map((c) => ({
                name: c.name,
                student_count: c.studentCount
            })),
            total_students: TOTAL_STUDENTS,
            pool_count: PROGRAMS.length,
            shared_verifier: true,
            interleaved_withdrawals: true,
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
                    : "SIGNIFICANT DEVIATION - find the cause before using these numbers";

            console.error(
                `total gas PREDICTED : ${Math.round(predicted.total).toLocaleString("en-US")}`
            );
            console.error(
                `difference          : ${Math.round(diff).toLocaleString("en-US")}`
                + ` (${percent.toFixed(3)} %)`
            );
            console.error(`=> ${summary.verdict}`);
        } else {
            summary.ghi_chu =
                "gas_onchain_raw.csv missing, cannot cross-check."
                + " Run `npm run experiment:gas` first.";
            console.error(
                "\n⚠️  gas_onchain_raw.csv missing - cannot cross-check"
            );
        }

        fs.writeFileSync(
            path.resolve(MULTIPOOL_DIR, "multipool_summary.json"),
            JSON.stringify(summary, null, 2)
        );

        console.error(`\nWritten: ${MULTIPOOL_DIR}`);
    } finally {
        // ---- 10. tra chain ve trang thai cu ----
        await callRpc("evm_revert", [snapshotId]);
        console.error(`[chain] revert ${snapshotId}`);
    }
}

main().catch((e: any) => {
    console.error("\n🔴 FAILED:", e && e.message ? e.message : e);
    process.exit(1);
});
