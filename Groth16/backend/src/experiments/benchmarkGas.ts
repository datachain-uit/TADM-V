// =============================================================================
// BƯỚC 3 — đo gas nhánh Groth16
//
// Soi gương zk-halo2-onchain/backend/src/experiments/benchmarkGas.ts:
// cùng thứ tự deploy verifier -> deploy pool -> updateRoot -> vòng verify+withdraw,
// cùng bộ kịch bản n = {1, 10, 30, 60, 100, 353, 500} (1 054 mẫu), và ĐÚNG
// 16 CỘT CSV giống hệt gas_onchain_raw.csv để hai file đặt cạnh nhau so được
// từng cột.
//
// 🔴 KHÁC BẢN ONC ĐÚNG HAI CHỖ, đều cố ý:
//   1. RPC mặc định cổng 8546, KHÔNG phải 8545 — hai repo kia dùng 8545 và
//      account[0]. Ràng buộc THẬT là "không hai nhánh chạy cùng lúc"; cổng
//      riêng chỉ là cách thi hành. Runner đọc biến RPC_URL, nên chạy chung
//      8545 cũng được khi không nhánh nào khác đang chạy.
//   2. Verifier có giao diện CÓ KIỂU (uint[2], uint[2][2], uint[2], uint[3])
//      thay vì blob `bytes`, nên lời gọi withdraw truyền tham số có kiểu.
//      Đây là nguồn của offset ~22 gas ở phép kiểm K1 (selector khác).
//
// 📌 Điểm khác thứ ba ĐÃ HẾT: trước đây chỉ bản này tắt keepAlive. ONC đã
//    thêm ở K19 (08/09/2026) vì `loadCommitments` gọi spawnSync n lần.
//
// 📌 ĐỒNG BỘ K19 — 2026-09-09: `updateRoot` nay công bố CẢ MẢNG commitment
//    thay vì mảng rỗng. Xem khối giải thích ở hàm `napCommitments`.
// =============================================================================

// Tu Node 19, agent HTTP toan cuc bat keepAlive va TAI SU DUNG socket cu.
// Loi goi RPC xen giua tac vu nang lam Ganache tha socket nhan roi, loi goi
// ke tiep an ECONNRESET. Tat keepAlive => moi loi goi mo ket noi moi.
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

// K19 — can de TINH LAI commitment cua ca kich ban roi cong bo len chuoi.
// Xem khoi "K19" ben duoi. `createCommitment` la ban port cua
// commitment.rs:20; `MerkleTree` dung de TU KIEM rang mang commitment
// dung la tap la sinh ra `root` ma proof dang chung minh.
const {
    MERKLE_DEPTH,
    MerkleTree,
    createCommitment
} = require("../utils/merkleTree");

const RPC_URL =
    process.env.RPC_URL
    || "http://127.0.0.1:8546";

const web3 =
    new Web3(
        RPC_URL
    );

// =========================
// PATHS
// =========================

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

/*
 * Proofs are INPUT here. With THU_MUC_KQ set they may not exist in the output
 * directory yet, so fall back to the published lot.
 */
function duongDanProof(n: number): string {
    const a = path.resolve(RESULT_DIR, `proofs_groth16_n${n}.json`);
    if (fs.existsSync(a)) return a;
    return path.resolve(
        PROJECT_ROOT,
        `experiments/results/quantitative/proofs_groth16_n${n}.json`
    );
}

const VERIFIER_ARTIFACT_PATH =
    path.resolve(
        PROJECT_ROOT,
        "contracts/artifacts/contracts/Groth16Verifier.sol/Groth16Verifier.json"
    );

const POOL_ARTIFACT_PATH =
    path.resolve(
        PROJECT_ROOT,
        "contracts/artifacts/contracts/ShieldedPoolGroth16.sol/ShieldedPoolGroth16.json"
    );

// K19 — `inputs_n*.json` giu (student_id, amount, rho) cua tung sinh vien,
// dung nhung gia tri DA DI VAO MACH. Tinh commitment tu day chu khong doc
// lai `dataset_n*.json` ben zk-halo2-onchain: it mot buoc phu thuoc, va bao
// dam commitment khop dung cai cay ma proof dang chung minh.
const DATA_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/data"
    );

// Luoc do cot: DINH_NGHIA_PHEP_DO.md muc 4.2 — GIONG HET ADV va ONC.
//   verify_onchain_ms  do `eth_call`, GOM round-trip RPC (D2). ADV do verify
//                      NATIVE — khac nghia hoan toan, dung dat canh nhau.
//   calldata_bytes     nam o performance CSV, khong o day (luoc do muc 4.1).
// 16 cot — GIONG HET gas_onchain_raw.csv sau khi port V1(b).
// Bon cot verify_record_* / settle_* la luong HAI GIAI DOAN.
const CSV_HEADER =
    "mechanism,n,student_index,"
    + "deploy_pool_gas,deploy_verifier_gas,update_root_gas,"
    + "verify_gas,verify_onchain_ms,"
    + "withdraw_gas,withdraw_ms,"
    + "verify_record_gas,verify_record_ms,"
    + "settle_gas,settle_ms,"
    + "root,nullifier\n";

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
//
// snarkjs exportSolidityCallData tra ve chuoi:
//   ["0x..","0x.."],[["0x..","0x.."],["0x..","0x.."]],["0x..","0x.."],["0x..","0x..","0x.."]
// Boc them cap ngoac vuong la parse duoc thanh [pA, pB, pC, pubSignals].
function tachCalldata(
    calldata: string
) {
    const parsed =
        JSON.parse(
            "[" + calldata + "]"
        );

    return {
        pA: parsed[0],
        pB: parsed[1],
        pC: parsed[2],
        pubSignals: parsed[3]
    };
}

function sangBytes32(
    x: string
): string {

    return web3.utils.padLeft(
        web3.utils.toHex(
            BigInt(x)
        ),
        64
    );
}

// =============================================================================
// K19 — CONG BO CA MANG COMMITMENT  (dong bo voi ONC, 2026-09-09)
// =============================================================================
//
// 🔴 TRUOC 09/09 CHO NAY TRUYEN MANG RONG, VA DO LA SAI.
//
// `updateRoot(root, commitments)` cong bo ca mang len chuoi (V4). Ban truoc
// truyen `[]` va comment o day con ghi "DA DOI CHIEU 2026-09-07: ONC cung
// truyen rong". Cau do DUNG ngay 07/09 va SAI tu 08/09: ONC sua o K19
// (commit b9a12ac) de tinh commitment tu dataset roi cong bo that.
//
// Hau qua neu khong sua — ONC ghi nguyen van: "ONC do mot duong code KHAC
// voi ADV, `update_root_gas` hai nhanh khong so duoc, va K1 mat y nghia."
// Do do o baseline: `update_root_gas` dung im o ~70 353 trong khi ADV va
// ONC deu tang theo `n` (~773 gas moi la). Cot do dang do MOT VIEC KHAC.
//
// KHAC ONC O CACH TINH, KHONG O KET QUA: ONC goi `runProver("commitment")`
// bang spawnSync `n` lan (nen no phai tat keepAlive o K19). Baseline tinh
// thang trong tien trinh bang circomlib Poseidon — cung cong thuc
// `commitment.rs:20`, khong spawn gi.
// ⚠️ Gia tri commitment HAI BEN KHAC NHAU vi ham bam khac cau truc hap thu
// (xem docs/circuit-mapping.md). Cai phai giong la SO LUONG va CACH cong bo
// — do la thu quyet dinh gas.
async function napCommitments(
    n: number
): Promise<{ mang: string[]; goc: bigint }> {

    const p =
        path.resolve(
            DATA_DIR,
            `inputs_n${n}.json`
        );

    if (!fs.existsSync(p)) {
        throw new Error(
            `Thieu ${p} — chay 'npm run experiment:prepare' truoc.`
        );
    }

    const duLieu =
        JSON.parse(
            fs.readFileSync(p, "utf8")
        );

    const banGhi: any[] =
        duLieu.inputs ?? [];

    if (banGhi.length !== n) {
        throw new Error(
            `inputs_n${n}.json co ${banGhi.length} ban ghi, mong doi ${n}.`
        );
    }

    const commitments: bigint[] = [];

    for (const r of banGhi) {

        const inp =
            r.input ?? {};

        commitments.push(
            await createCommitment(
                inp.student_id,
                inp.amount,
                inp.rho
            )
        );
    }

    // TU KIEM: mang vua tinh phai dung la tap la sinh ra `root`.
    //
    // Vi sao can. Neu thu tu tham so sai (vi du `amount` va `rho` doi cho)
    // thi commitment van ra so hop le, `updateRoot` van chay, gas van duoc
    // ghi — va khong co gi bao loi. Ta se cong bo `n` gia tri rac roi bao
    // cao gas cua chung. Phep kiem nay la thu duy nhat bat duoc.
    const cay =
        new MerkleTree(
            MERKLE_DEPTH
        );

    await cay.insertAll(
        commitments
    );

    return {
        mang: commitments.map(
            (
                c: bigint
            ) => sangBytes32(c.toString())
        ),
        goc: cay.root()
    };
}

// =========================
// RPC THO — cho evm_snapshot / evm_revert
// =========================
//
// web3 khong boc san hai method nay. Ganache tra ve khi thi
// {jsonrpc, id, result}, khi thi tra thang gia tri — boc ca hai.

async function goiRpc(
    method: string,
    params: any[] = []
): Promise<any> {
    const traVe: any =
        await (web3.currentProvider as any).request({
            method,
            params
        });

    return (
        traVe
        && typeof traVe === "object"
        && "result" in traVe
    )
        ? traVe.result
        : traVe;
}

// =========================
// K14 — KIEM MOI TRUONG DO  (thay cho kiemNenSach, 2026-09-07)
// =========================
//
// 🔴 CHOT CU (`kiemNenSach`) DOI DIEU NGUOC LAI VOI ADV/ONC — da go.
//
//   ADV, ONC : assertMeasurementEnvironment -> vi dataset PHAI LA tai khoan Ganache
//   G16 (cu) : kiemNenSach                  -> vi dataset PHAI CO SO DU 0
//
// Mot tai khoan Ganache luon co so du khac 0, nen KHONG Ganache nao thoa ca hai.
// Hau qua cua chot cu: vi cua G16 la vi la (so du 0) => moi `withdraw` bi EVM
// tinh them 25 000 gas phi tao tai khoan (EIP-161); vi cua ADV/ONC la tai khoan
// co san nen khong bi.
//
// => Ba cot `withdraw_gas` chenh nhau dung 25 000 gas vi MOI TRUONG, khong phai
//    vi co che. Va nhin CSV KHONG phat hien duoc.
//
// Bang chung tu chinh so do cua nhanh nay, luot 22/08: hai bang `277 218` va
// `302 290`, chenh dung 25 000. Neu vi dataset that su la tai khoan Ganache thi
// chung da co san 1000 ETH va khong bang nao bi cong EIP-161.
//
// Chep tu zk-halo2-onchain/backend/src/experiments/benchmarkGas.ts.

async function kiemMoiTruongDo(
    diaChi: string[]
) {
    const accounts: string[] =
        await web3.eth.getAccounts();

    const tapTaiKhoan = new Set(
        accounts.map(
            (
                a: string
            ) => a.toLowerCase()
        )
    );

    const lac = diaChi.filter(
        (
            dc: string
        ) => !tapTaiKhoan.has(dc.toLowerCase())
    );

    if (lac.length > 0) {
        throw new Error(
            [
                "GANACHE KHONG DUNG MNEMONIC: "
                + lac.length + "/" + diaChi.length
                + " vi trong dataset khong phai tai khoan Ganache.",
                "Vi dau tien khong khop: " + lac[0],
                "Dataset duoc sinh tu mnemonic \"test test ... junk\","
                + " duong dan m/44'/60'/0'/0/{index} — xem"
                + " prepareExperimentInputs.ts cua zk-halo2-onchain.",
                "Chay tiep se do NHAM he: vi dataset thanh vi la (so du 0),"
                + " moi lan withdraw bi cong them 25 000 gas phi tao tai khoan"
                + " EIP-161, nen `withdraw_gas` KHONG so duoc voi ADV/ONC.",
                "Cach sua — chay MOT DONG (PowerShell):",
                "  ganache --port 8546 --wallet.totalAccounts 501"
                + " --wallet.mnemonic \"test test test test test test test"
                + " test test test test junk\""
            ].join("\n")
        );
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
    const contract =
        new web3.eth.Contract(
            artifact.abi
        );

    const deployTx =
        contract.deploy({
            data: artifact.bytecode,
            arguments: args
        });

    const estimatedGas =
        await deployTx.estimateGas({
            from,
            value
        });

    let receipt: any = null;

    const instance =
        await deployTx
            .send({
                from,
                value,
                gas: Number(estimatedGas) + 1000000
            })
            .on(
                "receipt",
                (r: any) => {
                    receipt = r;
                }
            );

    return {
        instance,
        address: instance.options.address,
        gasUsed: Number(receipt.gasUsed)
    };
}

// =========================
// DO VERIFY
// =========================

async function measureVerify(
    verifier: any,
    verifierAddress: string,
    pA: any,
    pB: any,
    pC: any,
    pubSignals: any,
    from: string,
    studentIndex: number
) {
    const goi =
        verifier.methods.verifyProof(
            pA,
            pB,
            pC,
            pubSignals
        );

    // verify_onchain_ms — eth_call, GOM round-trip RPC (D2).
    //
    // 🔴 KHAC HAN verify_native_ms cua ADV: cai kia do phep tinh mat ma
    // trong tien trinh, cai nay do RPC + EVM Ganache + phep tinh, chua tach
    // duoc ba phan. Dat hai cot cung ten la ra ket luan lech ~40 lan.
    // Cot nay CHI dung de so ONC <-> G16 (cung chay tren cung Ganache).
    const t0 =
        performance.now();

    const ketQua =
        await goi.call({
            from
        });

    const verifyOnchainMs =
        performance.now() - t0;

    if (ketQua !== true) {
        throw new Error(
            `verifyProof tra ve ${ketQua} o student_index=${studentIndex}. `
            + `Proof khong hop le — DUNG, dung ghi so nay vao ket qua.`
        );
    }

    // Gas: gui giao dich that toi verifier, giong cach ONC do
    const data =
        goi.encodeABI();

    const estimatedGas =
        await web3.eth.estimateGas({
            from,
            to: verifierAddress,
            data
        });

    const receipt =
        await web3.eth.sendTransaction({
            from,
            to: verifierAddress,
            data,
            gas: Number(estimatedGas) + 100000
        });

    return {
        verifyOnchainMs,
        verifyGas: Number(receipt.gasUsed)
    };
}

// =========================
// MAIN
// =========================

async function main() {

    for (const p of [VERIFIER_ARTIFACT_PATH, POOL_ARTIFACT_PATH]) {

        if (!fs.existsSync(p)) {
            throw new Error(
                `Thieu ${p}\n`
                + `Sinh verifier roi compile contracts truoc — xem FULL_FLOW_TEST.md muc 4 va 5.`
            );
        }
    }

    const VERIFIER_ARTIFACT =
        require(VERIFIER_ARTIFACT_PATH);

    const POOL_ARTIFACT =
        require(POOL_ARTIFACT_PATH);

    fs.mkdirSync(
        RESULT_DIR,
        {
            recursive: true
        }
    );

    const accounts =
        await web3.eth.getAccounts();

    if (accounts.length === 0) {
        throw new Error(
            `Khong co account nao tren ${RPC_URL}. Ganache da chay chua?`
        );
    }

    const school =
        accounts[0];

    const csvPath =
        path.resolve(
            RESULT_DIR,
            "gas_groth16_raw.csv"
        );

    // Luoc do cot: DINH_NGHIA_PHEP_DO.md muc 4.2 — GIONG HET ADV va ONC.
    // Doi ten hai cot so voi ban truoc:
    //   verify_time_ms   -> verify_onchain_ms   (D2: no do eth_call, GOM round-trip RPC.
    //                                            ADV do verify NATIVE — khac nghia hoan toan)
    //   withdraw_time_ms -> withdraw_ms
    // calldata_bytes chuyen sang performance CSV cho khop luoc do muc 4.1.
    // 16 cot — GIONG HET gas_onchain_raw.csv sau khi port V1(b).
    // Bon cot verify_record_* / settle_* la luong HAI GIAI DOAN.
    // `withdraw_gas` / `withdraw_ms` giu lai va de TRONG: ham `withdraw` mot
    // giao dich khong con ton tai o ca hai ben. Giu cot de doi chieu duoc voi
    // ADV (nhanh do van dung mot giao dich `withdrawOffChain`).
    let csv = CSV_HEADER;

    const tomTat: any[] = [];

    const kichBan =
        chonKichBan();

    // -------------------------------------------------------------
    // K0 — CHOT NEN SACH, chay TRUOC khi do bat cu thu gi
    // -------------------------------------------------------------
    //
    // Duyet MOI dia chi trong MOI kich ban. Chi mot vi da co so du la dung.

    const moiDiaChi: string[] = [];

    for (const n of kichBan) {

        const f =
            duongDanProof(n);

        if (!fs.existsSync(f)) {
            throw new Error(
                `Thieu ${f} — chay buoc sinh proof truoc.`
            );
        }

        for (const p of JSON.parse(fs.readFileSync(f, "utf8"))) {

            if (
                p.address
                && moiDiaChi.indexOf(p.address) === -1
            ) {
                moiDiaChi.push(p.address);
            }
        }
    }

    await kiemMoiTruongDo(moiDiaChi);

    console.error(
        `K14 dat: ${moiDiaChi.length}/${moiDiaChi.length} vi dataset la tai khoan Ganache.`
    );

    for (const n of kichBan) {

        // ---------------------------------------------------------
        // RESET TRUOC MOI KICH BAN — D3 cua DINH_NGHIA_PHEP_DO.md
        // ---------------------------------------------------------
        //
        // Sau dataset dung CHUNG day vi: dataset_n10 lay dung 5 vi cua
        // dataset_n5 roi them 5 vi moi. Khong reset thi toi kich ban sau,
        // cac vi dau DA nhan tien roi nen re hon ~25 000 gas (phi tao tai
        // khoan EIP-161). Hau qua: trung binh theo n trong nhu GIAM DAN
        // => nguoi doc ket luan "n cang lon gas cang re", sai hoan toan.
        //
        // evm_revert TIEU LUON snapshot, nen phai chup moi o dau moi vong.

        const anhChup =
            await goiRpc("evm_snapshot");

        if (!anhChup) {
            throw new Error(
                "Ganache khong tra ve snapshot id truoc n = " + n
                + ". Khong reset duoc giua cac kich ban => withdraw_gas"
                + " se nhiem thu tu chay. Dung lai thay vi cho ra so sai."
            );
        }

        const proofPath =
            duongDanProof(n);

        const proofs =
            JSON.parse(
                fs.readFileSync(
                    proofPath,
                    "utf8"
                )
            );

        if (proofs.length === 0) {
            throw new Error(
                `proofs_groth16_n${n}.json rong.`
            );
        }

        const daTach =
            proofs.map(
                (p: any) => tachCalldata(p.calldata)
            );

        // Root cua kich ban: lay tu public input cua proof dau tien.
        const scenarioRoot =
            sangBytes32(
                daTach[0].pubSignals[0]
            );

        // Von pool = dung tong amount cua n proof, cong mot phan du.
        // Lay tu chinh public input, KHONG hang so hoa — bản ONC ghi rõ vì sao:
        // require "insufficient pool" so voi chinh amount trong proof.
        const tongAmount =
            daTach.reduce(
                (
                    cong: bigint,
                    d: any
                ) => cong + BigInt(d.pubSignals[2]),
                BigInt(0)
            );

        const poolValue =
            (
                tongAmount
                + tongAmount / BigInt(n)
            ).toString();

        // =========================
        // DEPLOY VERIFIER
        // =========================

        const verifierDeploy =
            await deployContract(
                VERIFIER_ARTIFACT,
                [],
                school
            );

        console.error(
            `n=${n} verifier=${verifierDeploy.address} deployGas=${verifierDeploy.gasUsed}`
        );

        // =========================
        // DEPLOY POOL
        // =========================

        // V1(b) — pool MOT MENH GIA. Moi sinh vien trong dataset cung amount,
        // nen lay tu chinh public input cua proof dau tien, KHONG hang so hoa.
        const menhGia =
            BigInt(daTach[0].pubSignals[2]).toString();

        const poolDeploy =
            await deployContract(
                POOL_ARTIFACT,
                [verifierDeploy.address, menhGia],
                school,
                poolValue
            );

        const pool =
            poolDeploy.instance;

        // -----------------------------------------------------------------
        // POOL THU HAI — chi de do duong `withdraw` mot giao dich.
        //
        // Vi sao phai tach: `withdraw` va `settle` DEU tieu nullifier
        // (usedNullifier = true). Chay ca hai tren cung mot pool thi duong
        // thu hai revert "nullifier already used".
        //
        // Hai pool giong het nhau: cung verifier, cung menh gia, cung von,
        // cung root. Chi khac o cho nullifier duoc tieu. `deploy_pool_gas`
        // hai ben bang nhau nen cot do khong bi anh huong.
        // -----------------------------------------------------------------

        const poolWDeploy =
            await deployContract(
                POOL_ARTIFACT,
                [verifierDeploy.address, menhGia],
                school,
                poolValue
            );

        const poolW =
            poolWDeploy.instance;

        console.error(
            `n=${n} pool=${poolDeploy.address} poolW=${poolWDeploy.address}`
            + ` deployGas=${poolDeploy.gasUsed}`
        );

        // =========================
        // UPDATE ROOT MOT LAN
        // =========================
        //
        // V4 — updateRoot nhan them mang commitment de cong bo.
        //
        // K19 (2026-09-09): cong bo CA MANG, dung nhu ADV va nhu ONC sau
        // commit b9a12ac. Xem khoi giai thich o ham `napCommitments`.
        // ⇒ `update_root_gas` nay TANG THEO `n` o ca ba nhanh, va K1 so duoc
        //   tren ca ba thay vi chi ONC ↔ G16.

        const congBo =
            await napCommitments(n);

        // Goc tinh lai phai khop goc trong public input cua proof. Lech
        // nghia la mang commitment KHONG phai tap la cua cay ma proof dang
        // chung minh — cong bo tiep la cong bo rac.
        const gocTinhLai =
            sangBytes32(
                congBo.goc.toString()
            );

        if (gocTinhLai !== scenarioRoot) {
            throw new Error(
                [
                    `K19 THAT BAI o n = ${n}: goc tinh lai tu commitment`
                    + " KHONG khop goc trong proof.",
                    `  tinh lai : ${gocTinhLai}`,
                    `  trong proof: ${scenarioRoot}`,
                    "Nghia la `createCommitment` va buoc sinh input dang dung"
                    + " hai quy uoc khac nhau (thu tu tham so, hoac depth).",
                    "Dung lai thay vi cong bo mot mang commitment vo nghia roi"
                    + " ghi gas cua no."
                ].join("\n")
            );
        }

        // `gas: 30000000` — bang tran block. Cong bo 500 commitment ton hon
        // 500 000 rat nhieu; ONC cung phai nang o K19. De nguyen muc cu thi
        // n = 353 va 500 revert "out of gas".
        const updateRootTx =
            await pool.methods.updateRoot(
                scenarioRoot,
                congBo.mang
            ).send({
                from: school,
                gas: 30000000
            });

        const updateRootGas =
            Number(
                updateRootTx.gasUsed
            );

        // Pool thu hai phai co cung root, khong thi `withdraw` revert
        // "root not in history". Gas cua lan nay KHONG ghi vao CSV —
        // no la ban sao, khong phai mot phep do them.
        await poolW.methods.updateRoot(
            scenarioRoot,
            congBo.mang
        ).send({
            from: school,
            gas: 30000000
        });

        // =========================
        // VERIFY + WITHDRAW TUNG PROOF
        // =========================

        for (
            let i = 0;
            i < proofs.length;
            i++
        ) {
            const proofData =
                proofs[i];

            const {
                pA,
                pB,
                pC,
                pubSignals
            } = daTach[i];

            const root =
                sangBytes32(pubSignals[0]);

            const nullifier =
                sangBytes32(pubSignals[1]);

            const amountWei =
                BigInt(pubSignals[2]).toString();

            const recipient =
                proofData.address || accounts[2];

            // 1. Verify proof
            const verifyResult =
                await measureVerify(
                    verifierDeploy.instance,
                    verifierDeploy.address,
                    pA,
                    pB,
                    pC,
                    pubSignals,
                    school,
                    proofData.student_index
                );

            // -----------------------------------------------------------
            // Do CA BA duong, giong ONC.
            //
            // Thu tu bat buoc: `withdraw` TRUOC, vi no tieu nullifier
            // (usedNullifier = true). Chay verifyAndRecord/settle truoc thi
            // withdraw se revert "nullifier already used".
            //
            // => Moi sinh vien duoc do o MOT trong hai duong, khong phai ca
            //    hai. Nen o day dung HAI POOL rieng: poolW cho `withdraw`,
            //    pool cho luong hai giai doan. Cung verifier, cung root,
            //    cung von — chi khac o cho nullifier duoc tieu.
            // -----------------------------------------------------------

            // 2. Duong MOT GIAO DICH — withdraw (tren poolW)
            const goiRut =
                poolW.methods.withdraw(
                    pA, pB, pC, pubSignals,
                    root, nullifier, recipient, amountWei
                );

            const tWithdraw =
                performance.now();

            const withdrawTx =
                await goiRut.send({
                    from: school,
                    gas: 2000000
                });

            const withdrawMs =
                performance.now() - tWithdraw;

            // 3. Duong HAI GIAI DOAN — verifyAndRecord (tren pool)
            const goiVerifyRecord =
                pool.methods.verifyAndRecord(
                    pA, pB, pC, pubSignals,
                    root, nullifier, recipient, amountWei
                );

            const tVerifyRecord =
                performance.now();

            const verifyRecordTx =
                await goiVerifyRecord.send({
                    from: school,
                    gas: 2000000
                });

            const verifyRecordMs =
                performance.now() - tVerifyRecord;

            // 4. settle — CHI nhan nullifier
            const tSettle =
                performance.now();

            const settleTx =
                await pool.methods.settle(
                    nullifier
                ).send({
                    from: school,
                    gas: 2000000
                });

            const settleMs =
                performance.now() - tSettle;

            console.error(
                `  n=${n} idx=${proofData.student_index} `
                + `verifyGas=${verifyResult.verifyGas} `
                + `withdrawGas=${Number(withdrawTx.gasUsed)} `
                + `verifyRecordGas=${Number(verifyRecordTx.gasUsed)} `
                + `settleGas=${Number(settleTx.gasUsed)}`
            );

            csv += [
                "groth16",
                n,
                proofData.student_index,
                poolDeploy.gasUsed,
                verifierDeploy.gasUsed,
                updateRootGas,
                verifyResult.verifyGas,
                verifyResult.verifyOnchainMs.toFixed(6),
                Number(withdrawTx.gasUsed),
                withdrawMs.toFixed(6),
                Number(verifyRecordTx.gasUsed),
                verifyRecordMs.toFixed(6),
                Number(settleTx.gasUsed),
                settleMs.toFixed(6),
                root,
                nullifier
            ].join(",") + "\n";
        }

        // Ghi lai sau MOI kich ban, khong doi het vong — giong ONC.
        // Kich ban lon lau nhat; hong o do thi cac kich ban truoc van con
        // tren dia.
        fs.writeFileSync(
            csvPath,
            csv
        );

        /*
         * Dong bo voi ONC (K19) — ghi them MOT FILE MOI KICH BAN:
         *   gas_groth16_n<N>.csv   <- khop kieu `performance_groth16_n<N>.csv`
         *
         * Cung mot du lieu, chi khac cach chia. KHONG con so nao doi.
         */
        const dongCuaKichBan =
            csv
                .trim()
                .split("\n")
                .slice(1)
                .filter(
                    (
                        dong: string
                    ) => dong.split(",")[1] === String(n)
                );

        const csvPathTheoN =
            path.resolve(
                RESULT_DIR,
                `gas_groth16_n${n}.csv`
            );

        fs.writeFileSync(
            csvPathTheoN,
            CSV_HEADER + dongCuaKichBan.join("\n") + "\n"
        );

        console.error(
            `Da ghi n=${n} -> gas_groth16_raw.csv va`
            + ` gas_groth16_n${n}.csv (${dongCuaKichBan.length} dong)`
        );

        // ---------------------------------------------------------
        // REVERT — tra chuoi ve dung trang thai truoc kich ban nay
        // ---------------------------------------------------------

        const daRevert =
            await goiRpc("evm_revert", [anhChup]);

        if (daRevert !== true) {
            throw new Error(
                "evm_revert tra ve " + JSON.stringify(daRevert)
                + " sau n = " + n + " (mong doi true). Chuoi CHUA duoc"
                + " don, nen kich ban ke tiep se do sai. Dung lai."
            );
        }

        console.error(
            `Da revert chuoi ve trang thai sach sau n = ${n}`
        );

        tomTat.push({
            n,
            soProof: proofs.length,
            deployVerifierGas: verifierDeploy.gasUsed,
            deployPoolGas: poolDeploy.gasUsed,
            updateRootGas
        });
    }

    console.log(
        JSON.stringify(
            {
                buoc: "benchmarkGas",
                heChungMinh: "groth16 (circom/snarkjs)",
                rpc: RPC_URL,
                kichBan: tomTat,
                file: path.relative(
                    PROJECT_ROOT,
                    csvPath
                )
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
