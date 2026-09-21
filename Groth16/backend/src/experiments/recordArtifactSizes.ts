// =============================================================================
// BƯỚC 4 — ghi kích thước artifact, để so với artifact_sizes.json của ONC
//
// Soi gương zk-halo2-onchain/backend/src/experiments/recordArtifactSizes.ts.
// Giữ NGUYÊN tên trường để hai file đặt cạnh nhau đọc được:
//   source_bytes · deployed_bytecode_bytes · creation_bytecode_bytes
//   eip170_limit_bytes · eip170_usage_percent
//   pool_contract · withdraw_calldata · block_gas · bytecode_vs_deploy_gas
//
// ⚠️ ONC ghi ba số khác nhau cho verifier (86 056 / 19 989 / 20 021).
//    Số so với EIP-170 là deployed_bytecode_bytes. Đừng lấy source_bytes.
//
// ✅ CÁCH TÍNH THỐNG KÊ SAO Y ONC — đối chiếu 2026-09-07:
//    mean = trung bình cộng, `Math.round(mean)`; kèm min · max · samples.
//    block_gas_percent    = Math.round(mean / 30e6 * 10000) / 100   (ONC:361)
//    eip170_usage_percent = Math.round(byte / 24576 * 1000) / 10    (ONC:229)
//    gas_per_byte_measured= Math.round(gas / byte * 100) / 100      (ONC:459)
//    Dùng đúng công thức chứ không dùng toFixed: hai cách làm tròn có thể
//    lệch ở trường hợp hoà, mà hai bảng phải khớp TỪNG CHỮ SỐ mới đặt cạnh
//    nhau được.
//
// 🔴 KHÔNG GHI CỨNG THÔNG SỐ MẠCH. Bản trước ghi cứng `merkle_depth: 7` và
//    `max_leaves_per_pool: 128`; mạch đã sang `d = 9` từ 2026-09-07 mà hai
//    dòng đó vẫn nằm im, nên file kết quả tự mô tả sai chính nó. Nay đọc
//    thẳng từ `build/withdraw.r1cs` — mạch đổi thì số đổi theo.
// =============================================================================

const fs = require("fs");
const path = require("path");
const os = require("os");
const snarkjs = require("snarkjs");

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
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

const VERIFIER_SOL =
    path.resolve(
        PROJECT_ROOT,
        "contracts/contracts/Groth16Verifier.sol"
    );

const VERIFIER_ARTIFACT_PATH =
    path.resolve(
        PROJECT_ROOT,
        "contracts/artifacts/contracts/Groth16Verifier.sol/Groth16Verifier.json"
    );

const POOL_SOL =
    path.resolve(
        PROJECT_ROOT,
        "contracts/contracts/ShieldedPoolGroth16.sol"
    );

const POOL_ARTIFACT_PATH =
    path.resolve(
        PROJECT_ROOT,
        "contracts/artifacts/contracts/ShieldedPoolGroth16.sol"
        + "/ShieldedPoolGroth16.json"
    );

const R1CS_PATH =
    path.resolve(
        PROJECT_ROOT,
        "build/withdraw.r1cs"
    );

const BUILD_INFO_DIR =
    path.resolve(
        PROJECT_ROOT,
        "contracts/artifacts/build-info"
    );

const GAS_CSV =
    path.resolve(
        RESULT_DIR,
        "gas_groth16_raw.csv"
    );

const EIP170_LIMIT = 24576;

// 30 000 000 la GIA DINH ve mainnet, KHONG phai phep do. Cac so gas ben duoi
// moi la phep do. Giu dung con so ONC dung, neu khong hai bang khong so duoc.
const BLOCK_GAS_LIMIT = 30000000;

// Hang so Yellow Paper — gia luu MOT byte ma len chuoi. KHONG phai phep do.
const G_CODEDEPOSIT_PER_BYTE = 200;

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

function soByteHex(
    hex: string
): number {

    if (!hex) {
        return 0;
    }

    const s =
        hex.startsWith("0x")
            ? hex.slice(2)
            : hex;

    // Sao y ONC:225 — Math.floor((len - 2) / 2). Ket qua nhu nhau voi hex
    // hop le, nhung giu y het de hai file khong bao gio le nhau.
    return Math.floor(s.length / 2);
}

// =========================
// DOC CSV GAS
// =========================

function docCsv(
    p: string
): Record<string, string>[] {

    const raw =
        fs.readFileSync(p, "utf8")
            .trim()
            .split(/\r?\n/);

    const dong0 = raw[0];

    if (dong0 === undefined) {
        return [];
    }

    const cot =
        dong0.split(",");

    return raw.slice(1).map(
        (
            d: string
        ) => {
            const o: Record<string, string> = {};
            const v = d.split(",");

            cot.forEach(
                (
                    c: string,
                    i: number
                ) => {
                    o[c] = v[i] ?? "";
                }
            );

            return o;
        }
    );
}

function cot(
    rows: Record<string, string>[],
    ten: string
): number[] {

    return rows
        .map(
            (r) => r[ten]
        )
        .filter(
            (x): x is string =>
                x !== undefined && x.trim() !== ""
        )
        .map(Number)
        .filter(
            (x: number) => Number.isFinite(x)
        );
}

function khoiGas(
    v: number[]
): any {

    if (v.length === 0) {
        return null;
    }

    const mean =
        v.reduce(
            (a: number, b: number) => a + b,
            0
        ) / v.length;

    return {
        mean: Math.round(mean),
        min: Math.min(...v),
        max: Math.max(...v),
        samples: v.length,
        // Cong thuc SAO Y zk-halo2-onchain/.../recordArtifactSizes.ts:361.
        // Khong dung toFixed(2): hai cach lam tron co the le nhau o truong
        // hop hoa, va hai bang phai khop TUNG CHU SO thi moi dat canh nhau
        // duoc.
        block_gas_percent:
            Math.round(mean / BLOCK_GAS_LIMIT * 10000) / 100
    };
}

// =========================
// CHU KY HAM — DOC TU ABI
// =========================

// 🔴 Doc tu ABI, KHONG go tay. Ban dau toi go tay chu ky `withdraw` va go
// THIEU hai tham so (`bytes32` thu hai va `uint256`) — dung cai loi ma chinh
// file nay canh bao o dau. Chu ky sai keo theo selector sai, va selector la
// thu giai thich chenh lech gas voi ONC.
function chuKyHam(
    artifactJson: any,
    ten: string
): string {

    const abi: any[] =
        artifactJson.abi ?? [];

    for (const f of abi) {

        if (f.type === "function" && f.name === ten) {
            return ten
                + "("
                + (f.inputs ?? []).map(
                    (i: any) => i.type
                ).join(",")
                + ")";
        }
    }

    return "(khong tim thay " + ten + " trong ABI)";
}

// Dem tham so, de khop hai truong `total_args` / `dynamic_args` cua ONC.
function demThamSo(
    artifactJson: any,
    ten: string
): { total_args: number; dynamic_args: number } {

    const abi: any[] =
        artifactJson.abi ?? [];

    for (const f of abi) {

        if (f.type === "function" && f.name === ten) {

            const inp: any[] = f.inputs ?? [];

            return {
                total_args: inp.length,
                dynamic_args: inp.filter(
                    (i: any) =>
                        String(i.type).indexOf("[]") !== -1
                        || i.type === "bytes"
                        || i.type === "string"
                ).length
            };
        }
    }

    return { total_args: 0, dynamic_args: 0 };
}

// =========================
// THIET LAP SOLC THAT SU DUNG
// =========================

// Doc tu artifacts/build-info — thiet lap solc THAT SU dung, khong chep tay
// tu hardhat.config.js. Hai thu nay ROI NHAU duoc, va khi roi thi con so
// bytecode khong con so voi ONC duoc nua.
function thietLapSolidity(): any {

    if (!fs.existsSync(BUILD_INFO_DIR)) {
        return {
            builds: [],
            note: "Khong tim thay artifacts/build-info — chua compile?"
        };
    }

    const builds: any[] = [];

    for (const f of fs.readdirSync(BUILD_INFO_DIR)) {

        if (!f.endsWith(".json")) {
            continue;
        }

        const bi =
            JSON.parse(
                fs.readFileSync(
                    path.resolve(BUILD_INFO_DIR, f),
                    "utf8"
                )
            );

        const st =
            bi.input?.settings ?? {};

        builds.push({
            solc: bi.solcVersion ?? "?",
            evm_version: st.evmVersion ?? "(mac dinh cua solc)",
            optimizer: st.optimizer?.enabled ? "on" : "off",
            optimizer_runs: st.optimizer?.runs ?? 200,
            contracts: Object.keys(
                bi.input?.sources ?? {}
            ).map(
                (s: string) => path.basename(s)
            )
        });
    }

    return {
        builds,
        note:
            "Doc tu artifacts/build-info — thiet lap solc THAT SU dung, "
            + "khong chep tay tu hardhat.config.js."
    };
}

// =========================
// MAIN
// =========================

async function main() {

    for (const p of [
        VERIFIER_SOL,
        VERIFIER_ARTIFACT_PATH,
        POOL_SOL,
        POOL_ARTIFACT_PATH,
        R1CS_PATH
    ]) {

        if (!fs.existsSync(p)) {
            throw new Error(
                `Thieu ${p} — xem FULL_FLOW_TEST.md muc 4 va 5.`
            );
        }
    }

    const artifact =
        require(VERIFIER_ARTIFACT_PATH);

    const deployedBytes =
        soByteHex(
            artifact.deployedBytecode
        );

    const creationBytes =
        soByteHex(
            artifact.bytecode
        );

    const poolArtifact =
        require(POOL_ARTIFACT_PATH);

    const poolDeployedBytes =
        soByteHex(
            poolArtifact.deployedBytecode
        );

    const poolCreationBytes =
        soByteHex(
            poolArtifact.bytecode
        );

    // Thong so mach — DOC RA, khong ghi cung.
    const r1cs =
        await snarkjs.r1cs.info(R1CS_PATH);

    const merkleDepth =
        r1cs.nPrvInputs >= 2
            ? (r1cs.nPrvInputs - 2) / 2
            : 0;

    // Calldata: doc tu chinh proof da sinh, khong hang so hoa.
    const perScenario: any = {};

    for (const n of SCENARIOS) {

        const proofPath =
            path.resolve(
                RESULT_DIR,
                `proofs_groth16_n${n}.json`
            );

        if (!fs.existsSync(proofPath)) {
            continue;
        }

        const proofs =
            JSON.parse(
                fs.readFileSync(
                    proofPath,
                    "utf8"
                )
            );

        const kichThuoc =
            proofs.map(
                (p: any) => Buffer.from(
                    JSON.stringify(p.proof)
                ).length
            );

        perScenario[`n${n}`] = {
            records: proofs.length,
            proof_json_bytes_min: Math.min(...kichThuoc),
            proof_json_bytes_max: Math.max(...kichThuoc)
        };
    }

    // Gas — doc tu CSV that, khong go tay.
    const gasRows =
        fs.existsSync(GAS_CSV)
            ? docCsv(GAS_CSV)
            : [];

    const gWithdraw = khoiGas(cot(gasRows, "withdraw_gas"));
    const gVerifyRec = khoiGas(cot(gasRows, "verify_record_gas"));
    const gSettle = khoiGas(cot(gasRows, "settle_gas"));
    const gPool = khoiGas(cot(gasRows, "deploy_pool_gas"));
    const gVerifier = khoiGas(cot(gasRows, "deploy_verifier_gas"));

    // 🔴 `calldata_bytes` nam o performance_*.csv, KHONG o gas_*.csv. Ban dau
    // doc nham file nen truong nay ra `null` ma khong bao loi gi — dung kieu
    // loi im lang ma file nay canh bao o dau.
    const calldataBytes: number[] = [];

    for (const n of SCENARIOS) {

        const perfPath =
            path.resolve(
                RESULT_DIR,
                `performance_groth16_n${n}.csv`
            );

        if (!fs.existsSync(perfPath)) {
            continue;
        }

        for (const v of cot(docCsv(perfPath), "calldata_bytes")) {
            calldataBytes.push(v);
        }
    }

    const tongHeThong =
        (gPool ? gPool.mean : 0)
        + (gVerifier ? gVerifier.mean : 0);

    const out = {
        metadata: {
            measured_at: new Date().toISOString(),
            // ONC ghi `git_commit`. `baseline-comparisons/` KHONG phai git
            // repo, nen ghi thang ly do thay vi bo truong — bo truong thi
            // nguoi doi chieu tuong la quen.
            git_commit: null,
            git_commit_note:
                "baseline-comparisons/ khong phai git repo (code/ cung "
                + "khong). Khong co commit de ghim. Tai lap bang cach chay "
                + "lai day chuyen trong FULL_FLOW_TEST.md.",
            machine: {
                cpu: os.cpus()[0]
                    ? os.cpus()[0].model
                    : "unknown",
                cpu_cores: os.cpus().length,
                total_ram_gb: Number(
                    (os.totalmem() / 1024 / 1024 / 1024).toFixed(1)
                ),
                platform: `${os.platform()} ${os.release()}`,
                node: process.version
            },
            proof_system: {
                mechanism: "baseline-groth16",
                library: "circom 2.x + snarkjs (groth16)",
                curve: r1cs.curve?.name ?? "bn128",
                commitment_scheme: "Groth16 (pairing-based)",
                // ONC ghi `k: 13` (bac mach PLONKish). Groth16 dung R1CS,
                // KHONG co dai luong tuong duong — ghi null kem giai thich
                // chu KHONG bo truong, de ai doi chieu hai file thay ngay
                // day la "khong ton tai", khong phai "quen do".
                k: null,
                k_note:
                    "Groth16 dung R1CS, khong co tham so `k` nhu PLONKish. "
                    + "Dai luong tuong duong gan nhat la so rang buoc.",
                constraints: r1cs.nConstraints,
                private_inputs: r1cs.nPrvInputs,
                public_inputs_count: r1cs.nPubInputs,
                merkle_depth: merkleDepth,
                max_leaves_per_pool: Math.pow(2, merkleDepth),
                merkle_depth_source:
                    "SUY RA tu nPrvInputs = 2 + 2*depth "
                    + "(student_id, rho, siblings[depth], directions[depth]) "
                    + "— doc tu build/withdraw.r1cs, KHONG ghi cung.",
                public_inputs: [
                    "root",
                    "nullifier",
                    "amount"
                ],
                trusted_setup:
                    "Powers of Tau cong khai + phase 2 rieng cho MACH NAY. "
                    + "Groth16 doi hoi ceremony RIENG cho TUNG mach — day la truc "
                    + "danh doi chinh so voi hai nhanh cua bai. Entropy co dinh "
                    + "\"baseline-groth16-2026\" de tai lap duoc => du cho thuc "
                    + "nghiem, KHONG du de tuyen bo soundness."
            },
            solidity: thietLapSolidity(),
            chain: {
                rpc:
                    "Ganache "
                    + (process.env.RPC_URL ?? "http://127.0.0.1:8546"),
                startup_command:
                    "ganache --wallet.mnemonic \"test test test test test "
                    + "test test test test test test junk\" "
                    + "--wallet.totalAccounts 501",
                port_note:
                    "Mac dinh cua baseline la 8546 de KHONG dung do voi ADV/ONC "
                    + "(ca hai dung 8545 va account[0]). Luot do bao cao "
                    + "2026-09-07 chay tren 8545 — Ganache duy nhat cua nguoi "
                    + "dung — bang bien moi truong RPC_URL, KHONG sua code. "
                    + "Hop le vi luc do khong nhanh nao khac dang chay; ky luat "
                    + "\"khong hai nhanh cung luc\" cua CLAUDE.md duoc mo rong "
                    + "cho ca ba.",
                hardfork:
                    "Ganache mac dinh — phai khop evm_version o tren",
                opcodes_used_by_this_system:
                    "SLOAD, SSTORE, CALL, STATICCALL, bo nho, calldata — gia "
                    + "cua chung doi lan cuoi o Berlin/London, DEU TRUOC "
                    + "`paris`. Shanghai va Cancun chi THEM opcode, khong dinh "
                    + "gia lai opcode cu => cac so gas nay van dung tren "
                    + "mainnet hien tai.",
                gas_is_a_counted_quantity:
                    "Gas do DAC TA EVM an dinh, KHONG do may khach => mang "
                    + "sang mainnet duoc mien la hardfork khop. Thoi gian "
                    + "treo tuong thi KHONG mang sang duoc."
            }
        },

        verifier_contract: {
            source_bytes: fs.statSync(VERIFIER_SOL).size,
            deployed_bytecode_bytes: deployedBytes,
            creation_bytecode_bytes: creationBytes,
            eip170_limit_bytes: EIP170_LIMIT,
            // Sao y ONC:229 — Math.round(x/24576*1000)/10
            eip170_usage_percent:
                Math.round(deployedBytes / EIP170_LIMIT * 1000) / 10
        },

        pool_contract: {
            source_bytes: fs.statSync(POOL_SOL).size,
            deployed_bytecode_bytes: poolDeployedBytes,
            creation_bytecode_bytes: poolCreationBytes,
            eip170_limit_bytes: EIP170_LIMIT,
            eip170_usage_percent:
                Math.round(poolDeployedBytes / EIP170_LIMIT * 1000) / 10,
            note:
                "EIP-170 gioi han TUNG hop dong rieng. KHONG cong hai so nay "
                + "roi so voi 24 576."
        },

        withdraw_calldata: {
            function_signature: chuKyHam(poolArtifact, "withdraw"),
            verify_record_signature:
                chuKyHam(poolArtifact, "verifyAndRecord"),
            settle_signature: chuKyHam(poolArtifact, "settle"),
            selector_bytes: 4,
            total_args: demThamSo(poolArtifact, "withdraw").total_args,
            dynamic_args: demThamSo(poolArtifact, "withdraw").dynamic_args,
            // ONC ghi mot gia tri `calldata_bytes`. O G16 gia tri nay HANG SO
            // (proof Groth16 co kich thuoc co dinh) nen min === max; van ghi
            // ca ba truong de hai file doc canh nhau duoc.
            calldata_bytes:
                calldataBytes.length > 0
                    && Math.min(...calldataBytes) === Math.max(...calldataBytes)
                    ? Math.min(...calldataBytes)
                    : null,
            // ONC co hai truong nay vi no truyen proof duoi dang MOT BLOB
            // `bytes`. G16 truyen BON MANG CO KIEU nen khong ton tai blob —
            // ghi null kem giai thich chu KHONG bo truong.
            proof_blob_bytes: null,
            proof_blob_padded_bytes: null,
            proof_blob_note:
                "Khong ap dung: verifier snarkjs nhan bon mang co kieu "
                + "(uint[2], uint[2][2], uint[2], uint[3]), khong nhan blob "
                + "`bytes` nhu ONC. Chinh khac biet giao dien nay giai thich "
                + "offset 22 gas o phep kiem K1.",
            calldata_bytes_min:
                calldataBytes.length > 0
                    ? Math.min(...calldataBytes)
                    : null,
            calldata_bytes_max:
                calldataBytes.length > 0
                    ? Math.max(...calldataBytes)
                    : null,
            note:
                "Chu ky KHAC ONC: snarkjs sinh verifier nhan BON mang CO KIEU, "
                + "ONC nhan mot blob `bytes`. Day la khac biet GIAO DIEN, khong "
                + "phai khac biet he chung minh — no giai thich vi sao selector "
                + "va vi tri dispatch lech, keo theo update_root_gas lech ~22 "
                + "gas so voi ONC."
        },

        block_gas: {
            block_gas_limit: BLOCK_GAS_LIMIT,
            withdraw: gWithdraw,
            verify_record: gVerifyRec,
            settle: gSettle,
            deploy_pool: gPool,
            deploy_verifier: gVerifier,
            whole_system: {
                total_gas: tongHeThong,
                block_gas_percent:
                    Math.round(
                        tongHeThong / BLOCK_GAS_LIMIT * 10000
                    ) / 100,
                consists_of: "deploy_verifier_gas + deploy_pool_gas",
                second_pool_onward: gPool ? gPool.mean : null,
                second_pool_note:
                    "neu dung lai verifier — mot verifier phuc vu nhieu pool"
            },
            note:
                "block_gas_limit la GIA DINH ve mainnet (30M), KHONG phai phep "
                + "do. Cac so gas moi la phep do that tren Ganache. `withdraw` "
                + "la chi phi LAP LAI moi giao dich; `whole_system` la chi phi "
                + "MOT LAN — hai cau hoi khac nhau, dung gop."
        },

        bytecode_vs_deploy_gas: {
            g_codedeposit_per_byte: G_CODEDEPOSIT_PER_BYTE,
            g_codedeposit_source:
                "Yellow Paper — hang so EVM, KHONG phai phep do",
            // Ten truong va cong thuc SAO Y ONC:455-459 —
            // code_deposit_gas · deploy_gas_measured · remainder ·
            // gas_per_byte_measured = Math.round(gas/byte*100)/100
            verifier:
                gVerifier && deployedBytes > 0
                    ? {
                        deployed_bytecode_bytes: deployedBytes,
                        code_deposit_gas:
                            deployedBytes * G_CODEDEPOSIT_PER_BYTE,
                        deploy_gas_measured: gVerifier.mean,
                        remainder:
                            gVerifier.mean
                            - deployedBytes * G_CODEDEPOSIT_PER_BYTE,
                        gas_per_byte_measured:
                            Math.round(
                                gVerifier.mean / deployedBytes * 100
                            ) / 100
                    }
                    : null,
            pool:
                gPool && poolDeployedBytes > 0
                    ? {
                        deployed_bytecode_bytes: poolDeployedBytes,
                        code_deposit_gas:
                            poolDeployedBytes * G_CODEDEPOSIT_PER_BYTE,
                        deploy_gas_measured: gPool.mean,
                        remainder:
                            gPool.mean
                            - poolDeployedBytes * G_CODEDEPOSIT_PER_BYTE,
                        gas_per_byte_measured:
                            Math.round(
                                gPool.mean / poolDeployedBytes * 100
                            ) / 100
                    }
                    : null,
            measured_slope_gas_per_byte:
                gVerifier && deployedBytes > 0
                    ? Math.round(gVerifier.mean / deployedBytes * 100) / 100
                    : null,
            remainder_consists_of:
                "21 000 phi giao dich + 32 000 phi tao hop dong + ma khoi tao "
                + "gui kem duoi dang calldata + constructor chay",
            slope_explanation:
                "200 (ma luu len chuoi) + phan du: ma khoi tao CON phai gui "
                + "kem giao dich duoi dang calldata => tra tien HAI LAN cho "
                + "gan nhu cung luong byte, cong 21 000 phi giao dich + 32 000 "
                + "phi tao hop dong + constructor chay."
        },

        proof_calldata: {
            note:
                "So byte calldata that nam o cot calldata_bytes trong "
                + "gas_groth16_raw.csv. Cac so duoi day la kich thuoc JSON cua "
                + "proof, KHONG phai calldata — dung nham hai thu.",
            per_scenario: perScenario
        }
    };

    fs.mkdirSync(
        RESULT_DIR,
        {
            recursive: true
        }
    );

    const outPath =
        path.resolve(
            RESULT_DIR,
            "artifact_sizes_groth16.json"
        );

    fs.writeFileSync(
        outPath,
        JSON.stringify(
            out,
            null,
            2
        )
    );

    console.error(
        "Da ghi " + outPath
    );

    console.log(
        JSON.stringify(
            {
                merkle_depth: merkleDepth,
                constraints: r1cs.nConstraints,
                private_inputs: r1cs.nPrvInputs,
                verifier_deployed_bytes: deployedBytes,
                verifier_eip170_percent:
                    out.verifier_contract.eip170_usage_percent,
                pool_deployed_bytes: poolDeployedBytes,
                withdraw_block_percent:
                    gWithdraw ? gWithdraw.block_gas_percent : null,
                file: outPath
            },
            null,
            2
        )
    );
}

main().then(
    () => {
        // snarkjs giu mot worker pool cua duong cong; khong dong thi tien
        // trinh treo va buoc 4 cua script ba luot khong bao gio ket thuc.
        process.exit(0);
    }
).catch(
    (
        e: any
    ) => {
        console.error(e);
        process.exit(1);
    }
);
