/*
 * C-12 + C-14 — ghi kích thước artifact on-chain và khối metadata.
 *
 * C-12: kích thước Halo2Verifier.sol (source + bytecode đã deploy),
 *       calldata proof, và phần public input trong calldata.
 *       Đây là số liệu chi phí on-chain dùng cho C2 trong
 *       working/00_contributions.md.
 *
 * C-14: mọi file kết quả phải kèm điều kiện đo — thiếu nó thì
 *       so sánh không bảo vệ được trước reviewer.
 *
 * KHÔNG cần Ganache/MongoDB: đọc từ artifact và file proof đã sinh.
 *
 * Chạy:  npx ts-node src/experiments/recordArtifactSizes.ts
 * Ra:    experiments/results/artifact_sizes.json
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const RESULTS_DIR = path.join(REPO_ROOT, "experiments", "results", "quantitative");

function safeExec(command: string): string {
    try {
        return execSync(command, {
            cwd: REPO_ROOT,
            stdio: ["ignore", "pipe", "ignore"]
        })
            .toString()
            .trim();
    } catch (error) {
        return "unknown";
    }
}

/*
 * C-14 — điều kiện đo. Thiếu khối này thì con số không tái tạo
 * được và không so sánh được với baseline.
 */
function buildMetadata() {
    const cpus = os.cpus();

    return {
        measured_at: new Date().toISOString(),
        git_commit: safeExec("git rev-parse --short HEAD"),
        machine: {
            cpu: cpus.length > 0 ? cpus[0].model.trim() : "unknown",
            cpu_cores: cpus.length,
            total_ram_gb:
                Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
            platform: `${os.platform()} ${os.release()}`,
            node: process.version
        },
        proof_system: {
            mechanism: "onchain",
            library: "halo2-base / halo2-axiom + snark-verifier-sdk",
            curve: "BN254",
            commitment_scheme: "KZG (SHPLONK)",
            k: 13,
            merkle_depth: 9,
            max_leaves_per_pool: 512,
            public_inputs: ["root", "nullifier", "amount"],
            trusted_setup:
                "ParamsKZG::setup(13, ChaCha20Rng::from_seed([42u8; 32])) "
                + "- fixed seed, reproducible, NOT a ceremony"
        },
        solidity: readCompilerSettings(),

        /*
         * C-14 — vì sao khối này BẮT BUỘC có.
         *
         * GAS là đại lượng ĐẾM THEO ĐẶC TẢ EVM, không phải số đo hiệu
         * năng. Cùng bytecode + cùng hardfork thì mọi máy khách đếm ra
         * CÙNG MỘT SỐ. Đó là cơ sở để nói "số gas đo trên Ganache đại
         * diện được cho mainnet" — khác hẳn THỜI GIAN, thứ không
         * chuyển được vì Ganache chạy EVM bằng JavaScript.
         *
         * Xem DINH_NGHIA_PHEP_DO.md Đ2 và mục 3c.
         */
        chain: {
            rpc: "Ganache 127.0.0.1:8545",
            startup_command:
                "ganache --wallet.mnemonic \"test test test test test "
                + "test test test test test test junk\" "
                + "--wallet.totalAccounts 501",
            hardfork: "Ganache default - must match the evmVersion above",
            gas_is_a_counted_quantity:
                "Gas is fixed by the EVM specification, NOT by the client "
                + "=> it carries over to mainnet as long as the hardfork "
                + "matches. Wall-clock time does NOT carry over.",
            opcodes_used_by_this_system:
                "SLOAD, SSTORE, CALL, STATICCALL, memory, calldata - their "
                + "prices last changed at Berlin/London, both BEFORE paris. "
                + "Shanghai and Cancun only ADD opcodes; they do not reprice "
                + "existing ones => these gas figures still hold on today's "
                + "mainnet."
        }
    };
}

/*
 * Đọc cấu hình biên dịch THỰC TẾ từ artifacts/build-info thay vì chép
 * tay từ hardhat.config.js — chép tay là nguồn sai lệch âm thầm.
 */
function readCompilerSettings() {
    const dir = path.join(REPO_ROOT, "contracts", "artifacts", "build-info");

    if (!fs.existsSync(dir)) {
        return { note: "Not compiled yet - compiler settings unavailable" };
    }

    const result: any[] = [];

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json")) {
            continue;
        }

        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const s = (j.input && j.input.settings) || {};

        result.push({
            solc: j.solcVersion,
            evm_version: s.evmVersion || "(NOT PINNED - solc default)",
            optimizer: s.optimizer && s.optimizer.enabled ? "on" : "off",
            optimizer_runs: s.optimizer && s.optimizer.runs
                ? s.optimizer.runs
                : null,
            contracts: Object.keys((j.input && j.input.sources) || {})
                .map((x: string) => x.split("/").pop())
        });
    }

    return {
        builds: result,
        note:
            "Read from artifacts/build-info - the settings solc ACTUALLY used, "
            + "not copied from hardhat.config.js."
    };
}

function verifierSizes() {
    const source = path.join(
        REPO_ROOT, "contracts", "contracts", "Halo2Verifier.sol"
    );

    const artifact = path.join(
        REPO_ROOT, "contracts", "artifacts", "contracts",
        "Halo2Verifier.sol", "Halo2Verifier.json"
    );

    const result: any = {
        source_bytes: fs.existsSync(source)
            ? fs.statSync(source).size
            : null
    };

    if (fs.existsSync(artifact)) {
        const compiled = JSON.parse(fs.readFileSync(artifact, "utf8"));

        // bỏ "0x", 2 ký tự hex = 1 byte
        result.deployed_bytecode_bytes =
            Math.floor(
                (String(compiled.deployedBytecode).length - 2) / 2
            );

        result.creation_bytecode_bytes =
            Math.floor(
                (String(compiled.bytecode).length - 2) / 2
            );

        /*
         * EIP-170 giới hạn 24 576 byte cho bytecode đã deploy.
         * Đáng nêu trong bài: verifier ở gần ngưỡng nào.
         */
        result.eip170_limit_bytes = 24576;
        result.eip170_usage_percent =
            Math.round(
                result.deployed_bytecode_bytes / 24576 * 1000
            ) / 10;
    } else {
        result.note =
            "Not compiled - run `npx hardhat compile` in contracts/ first";
    }

    return result;
}

/*
 * Kích thước bytecode của một hợp đồng bất kỳ đã biên dịch.
 * Thêm 2026-08-23 cho dòng 2 mục 3c — trước đó chỉ đo verifier, nên
 * không đặt cạnh cột ADV được (ADV không có verifier).
 */
function contractSizes(contractFile: string, contractName: string) {
    const source = path.join(
        REPO_ROOT, "contracts", "contracts", contractFile
    );

    const artifact = path.join(
        REPO_ROOT, "contracts", "artifacts", "contracts",
        contractFile, `${contractName}.json`
    );

    const result: any = {
        source_bytes: fs.existsSync(source)
            ? fs.statSync(source).size
            : null
    };

    if (!fs.existsSync(artifact)) {
        result.note =
            "Not compiled - run `npx hardhat compile` in contracts/ first";
        return result;
    }

    const compiled = JSON.parse(fs.readFileSync(artifact, "utf8"));

    result.deployed_bytecode_bytes =
        Math.floor((String(compiled.deployedBytecode).length - 2) / 2);

    result.creation_bytecode_bytes =
        Math.floor((String(compiled.bytecode).length - 2) / 2);

    result.eip170_limit_bytes = 24576;
    result.eip170_usage_percent =
        Math.round(result.deployed_bytecode_bytes / 24576 * 1000) / 10;

    return result;
}

/*
 * Calldata một lượt rút theo ĐÚNG định nghĩa Đ7 — thêm 2026-08-23.
 *
 * 🔴 KHÁC với `proof_calldata` bên dưới. Cột `calldata_bytes` trong CSV
 *    lâu nay ghi độ dài BLOB proofAndSignals (128 byte public input +
 *    proof), KHÔNG phải calldata giao dịch. Đặt cạnh cột ADV là so hai
 *    thứ khác nhau. Hàm này tính đúng:
 *
 *      calldata = 4 byte ma ham
 *               + head : moi tham so 32 byte (bytes dong -> 32 byte offset)
 *               + tail : 32 byte length + du lieu dem boi so 32
 */
function withdrawCalldataBytes() {
    const artifact = path.join(
        REPO_ROOT, "contracts", "artifacts", "contracts",
        "ShieldedPool.sol", "ShieldedPool.json"
    );

    if (!fs.existsSync(artifact)) {
        return { note: "ShieldedPool not compiled" };
    }

    const compiled = JSON.parse(fs.readFileSync(artifact, "utf8"));

    const fn = (compiled.abi || []).find(
        (item: any) => item.type === "function" && item.name === "withdraw"
    );

    if (!fn) {
        return { note: "withdraw not found in ABI" };
    }

    // do dai blob proof thuc te, lay tu proofs_n1.json
    const proofFile = path.join(RESULTS_DIR, "proofs_n1.json");
    let blobBytes: number | null = null;

    if (fs.existsSync(proofFile)) {
        const records = JSON.parse(fs.readFileSync(proofFile, "utf8"));
        if (Array.isArray(records) && records.length > 0) {
            blobBytes = Number(records[0].calldata_bytes);
        }
    }

    if (blobBytes === null || !Number.isFinite(blobBytes)) {
        return {
            function_signature:
                `${fn.name}(${(fn.inputs || []).map((i: any) => i.type).join(",")})`,
            note: "proofs_n1.json missing - run experiment:proofs first"
        };
    }

    const argCount = (fn.inputs || []).length;
    const dynamicCount = (fn.inputs || []).filter(
        (i: any) => i.type === "bytes" || i.type === "string"
    ).length;

    const paddedTo32 = Math.ceil(blobBytes / 32) * 32;

    const bytes =
        4                       // ma ham
        + argCount * 32         // head (bytes lines chiem 32 byte offset)
        + dynamicCount * 32             // tail: length word
        + paddedTo32;             // tail: du lieu da dem

    return {
        function_signature:
            `${fn.name}(${(fn.inputs || []).map((i: any) => i.type).join(",")})`,
        selector_bytes: 4,
        total_args: argCount,
        dynamic_args: dynamicCount,
        proof_blob_bytes: blobBytes,
        proof_blob_padded_bytes: paddedTo32,
        calldata_bytes: bytes,
        note:
            "D7 definition: 4-byte selector + all ABI-encoded arguments. "
            + "THIS is the figure to compare against ADV (132 bytes), NOT "
            + "proof_calldata below."
    };
}

const BLOCK_GAS_LIMIT = 30_000_000;

function readColumn(file: string, ten: string): number[] {
    if (!fs.existsSync(file)) {
        return [];
    }

    const lines = String(fs.readFileSync(file, "utf8"))
        .split("\n")
        .filter((l: string) => l.trim().length > 0);

    if (lines.length < 2) {
        return [];
    }

    const columnIndex = String(lines[0]).split(",").indexOf(ten);

    if (columnIndex < 0) {
        return [];
    }

    const values: number[] = [];

    for (let i = 1; i < lines.length; i++) {
        const o = String(lines[i]).split(",")[columnIndex];
        const v = Number(o);
        if (o !== undefined && o !== "" && Number.isFinite(v) && v > 0) {
            values.push(v);
        }
    }

    return values;
}

function stats(values: number[]) {
    if (values.length === 0) {
        return null;
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    return {
        mean: Math.round(mean),
        min: Math.min(...values),
        max: Math.max(...values),
        samples: values.length,
        block_gas_percent:
            Math.round(mean / BLOCK_GAS_LIMIT * 10000) / 100
    };
}

/*
 * Dòng 6 mục 3c — hai câu hỏi KHÁC NHAU, đừng gộp:
 *
 *   withdraw : mot luot RUT chiem bao nhieu phan block  (lap lai)
 *   deploy   : DUNG HE co lot mot block khong           (mot lan)
 */
function blockGasShare() {
    const file = path.join(RESULTS_DIR, "gas_onchain_raw.csv");

    if (!fs.existsSync(file)) {
        return {
            block_gas_limit: BLOCK_GAS_LIMIT,
            note: "gas_onchain_raw.csv missing - run experiment:gas first"
        };
    }

    const withdraw = stats(readColumn(file, "withdraw_gas"));
    const deployPool = stats(readColumn(file, "deploy_pool_gas"));
    const deployVerifier = stats(readColumn(file, "deploy_verifier_gas"));

    /*
     * Thiet ke TACH (tu 25/08): verifyAndRecord roi settle.
     * `withdraw` o tren la thiet ke GOP, giu lam ban doi chung.
     * Thieu hai khoi nay thi JSON mo ta mot thiet ke khong con la
     * duong chinh — do la cho Cowork bat duoc 06/09.
     */
    const verifyRecord = stats(readColumn(file, "verify_record_gas"));
    const settle = stats(readColumn(file, "settle_gas"));
    const tach = (verifyRecord === null || settle === null)
        ? null
        : {
            total_gas: verifyRecord.mean + settle.mean,
            block_gas_percent:
                Math.round(
                    (verifyRecord.mean + settle.mean)
                    / BLOCK_GAS_LIMIT * 10000
                ) / 100,
            note:
                "verify_record_gas + settle_gas - the split design, which is "
                + "the real withdrawal path. Costs more than the folded "
                + "`withdraw` because of the second transaction base fee plus "
                + "the Claim storage write."
        };

    /*
     * ONC dựng hệ = 1 verifier + 1 pool.
     *
     * 📌 Verifier DÙNG CHUNG được cho nhiều pool (constructor nhận
     *    địa chỉ), đã kiểm bằng contracts/test/PoolIsolation.js.
     *    Nên pool thứ hai trở đi chỉ tốn deploy_pool_gas.
     *    NHƯNG deployScholarshipPoolService.ts hiện deploy verifier
     *    mới mỗi pool — khả năng có, cài đặt chưa tận dụng.
     */
    const wholeSystem = (deployPool === null || deployVerifier === null)
        ? null
        : {
            total_gas: deployVerifier.mean + deployPool.mean,
            block_gas_percent:
                Math.round(
                    (deployVerifier.mean + deployPool.mean)
                    / BLOCK_GAS_LIMIT * 10000
                ) / 100,
            consists_of: "deploy_verifier_gas + deploy_pool_gas",
            second_pool_onward: deployPool.mean,
            second_pool_note:
                "if the verifier is reused - see "
                + "contracts/test/PoolIsolation.js assertion 1"
        };

    return {
        block_gas_limit: BLOCK_GAS_LIMIT,

        withdraw: withdraw,
        verify_record: verifyRecord,
        settle: settle,
        split_total: tach,
        deploy_pool: deployPool,
        deploy_verifier: deployVerifier,
        whole_system: wholeSystem,

        note:
            "block_gas_limit is an ASSUMPTION about mainnet (30M), not a "
            + "measurement. The gas figures are real measurements on Ganache. "
            + "`withdraw` is a RECURRING per-transaction cost; `whole_system` "
            + "is a ONE-TIME cost - two different questions."
    };
}

/*
 * Quan hệ giữa kích thước bytecode và gas deploy — thêm 2026-08-23.
 *
 * EVM thu G_codedeposit = 200 gas mỗi byte mã LƯU lên chuỗi (Yellow
 * Paper). Nhưng độ dốc THẬT đo được trên ba hợp đồng của dự án là
 * ~213 gas/byte:
 *
 *   Halo2Verifier <-> ShieldedPool ONC : 211,85 gas/byte
 *   Halo2Verifier <-> ShieldedPool ADV : 214,48 gas/byte
 *
 * Chênh ~13 gas/byte là vì mã khởi tạo còn phải GỬI KÈM giao dịch
 * dưới dạng calldata — tức trả tiền HAI LẦN cho gần như cùng lượng
 * byte. Ghi ra để bài giải thích được vì sao verifier đắt, thay vì
 * nêu một con số gas trần trụi.
 */
function bytecodeVsDeployGas(
    poolBytes: number | null,
    poolGas: number | null,
    verifierBytes: number | null,
    verifierGas: number | null
) {
    function one(byte: number | null, gas: number | null) {
        if (byte === null || gas === null) {
            return null;
        }

        const codeDeposit = byte * 200;

        return {
            deployed_bytecode_bytes: byte,
            code_deposit_gas: codeDeposit,
            deploy_gas_measured: gas,
            remainder: gas - codeDeposit,
            gas_per_byte_measured: Math.round(gas / byte * 100) / 100
        };
    }

    return {
        g_codedeposit_per_byte: 200,
        g_codedeposit_source:
            "Ethereum Yellow Paper - an EVM constant, NOT a measurement",
        /*
         * TINH tu hai diem do, KHONG ghi tay.
         * Ban truoc ghi cung chuoi "~213" trong khi du lieu cua chinh
         * no cho 218,7 va 228,4 — Cowork bat duoc 06/09.
         */
        measured_slope_gas_per_byte:
            (poolBytes === null || poolGas === null
                || verifierBytes === null || verifierGas === null)
                ? null
                : Math.round(
                    (poolGas / poolBytes + verifierGas / verifierBytes)
                    / 2 * 10
                ) / 10,
        measured_slope_source:
            "arithmetic mean of the two measured points in `pool` and "
            + "`verifier` below - recomputed on every run, never hand-typed",
        slope_explanation:
            "200 (code deposited on chain) + the rest (creation bytecode is "
            + "also sent as transaction calldata, plus constructor work) - "
            + "the same bytes are paid twice",
        pool: one(poolBytes, poolGas),
        verifier: one(verifierBytes, verifierGas),
        remainder_consists_of:
            "21 000 base transaction + 32 000 contract creation "
            + "+ calldata for the creation bytecode + constructor execution",
        note:
            "Bytecode size and deploy gas are TWO VIEWS of one thing: bytes "
            + "answer 'is it allowed on chain at all' (EIP-170), gas answers "
            + "'how much does it cost'."
    };
}

function calldataSizes() {
    const perN: any = {};

    for (const n of [1, 10, 30, 60, 100, 353, 500]) {
        const file = path.join(RESULTS_DIR, `proofs_n${n}.json`);

        if (!fs.existsSync(file)) {
            perN[`n${n}`] = { note: "not generated yet" };
            continue;
        }

        const records = JSON.parse(fs.readFileSync(file, "utf8"));

        if (!Array.isArray(records) || records.length === 0) {
            perN[`n${n}`] = { note: "file is empty" };
            continue;
        }

        const sizes = records.map(
            (r: any) => Number(r.calldata_bytes)
        );

        perN[`n${n}`] = {
            records: records.length,
            calldata_bytes_min: Math.min(...sizes),
            calldata_bytes_max: Math.max(...sizes),
            generated_at: fs.statSync(file).mtime.toISOString()
        };
    }

    return {
        public_input_bytes: 128,
        public_input_layout: "[0..32) root · [32..64) nullifier · [64..96) amount · [96..128) recipient",
        per_scenario: perN,
        note:
            "calldata = 128-byte public input + the proof blob. Size does NOT "
            + "depend on n: every student has their own proof and the Merkle "
            + "depth is fixed at 9."
    };
}

function main() {
    if (!fs.existsSync(RESULTS_DIR)) {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }

    const verifierInfo: any = verifierSizes();
    const poolSizes: any = contractSizes("ShieldedPool.sol", "ShieldedPool");
    const blockGas: any = blockGasShare();

    const output = {
        metadata: buildMetadata(),
        verifier_contract: verifierInfo,

        // them 2026-08-23 — lines 2/5/6 muc 3c, de dat canh columnIndex ADV
        pool_contract: poolSizes,
        withdraw_calldata: withdrawCalldataBytes(),
        block_gas: blockGas,

        bytecode_vs_deploy_gas: bytecodeVsDeployGas(
            typeof poolSizes.deployed_bytecode_bytes === "number"
                ? poolSizes.deployed_bytecode_bytes
                : null,
            blockGas.deploy_pool ? blockGas.deploy_pool.mean : null,
            typeof verifierInfo.deployed_bytecode_bytes === "number"
                ? verifierInfo.deployed_bytecode_bytes
                : null,
            blockGas.deploy_verifier ? blockGas.deploy_verifier.mean : null
        ),

        /*
         * 🔴 KHONG phai calldata giao dich. Day la do dai BLOB
         * proofAndSignals (128 byte public input + proof). Giu lai vi
         * no la so lieu that va da duoc trich dan; nhung khi so voi
         * ADV thi dung `withdraw_calldata` o tren — xem D7.
         */
        proof_calldata: calldataSizes()
    };

    const target = path.join(RESULTS_DIR, "artifact_sizes.json");

    fs.writeFileSync(
        target,
        JSON.stringify(output, null, 2)
    );

    console.log(JSON.stringify(output, null, 2));
    console.error(`\nĐã ghi: ${target}`);
}

main();
