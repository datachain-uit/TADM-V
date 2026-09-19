/*
 * K19 — 08/09/2026: BAT BUOC, dung ngay dong dau.
 *
 * `loadCommitments` goi prover bang `spawnSync` n lan, chan event loop
 * du lau de Ganache ngat socket keep-alive => RPC ke tiep bao ECONNRESET
 * va runner chet giua chung. Da xay ra that: 3 luot lien tiep chet o
 * n = 100, con n = 353/500 khong bao gio chay.
 *
 * CLAUDE.md ghi ro luat nay cho moi runner co spawnSync. Truoc K19
 * runner nay khong spawn gi nen khong can; nay can.
 */
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

const {
    normalizeCalldata,
    extractPublicInputs,
    extractRootAndNullifier,
    verifyProofByCall,
    withdrawWithProofData,
    verifyAndRecordWithProofData,
    settleByNullifier
} = require("../clients/blockchain/shieldedPoolClient");

const web3 =
    new Web3(
        "http://127.0.0.1:8545"
    );

// =========================
// PATHS
// =========================

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const RESULT_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/results/quantitative"
    );

// =========================
// ARTIFACTS
// =========================

const POOL_ARTIFACT =
    require(
        path.resolve(
            PROJECT_ROOT,
            "contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json"
        )
    );

const VERIFIER_ARTIFACT =
    require(
        path.resolve(
            PROJECT_ROOT,
            "contracts/artifacts/contracts/Halo2Verifier.sol/Halo2Verifier.json"
        )
    );

// =========================
// CONFIG
// =========================

const SCENARIOS_MAC_DINH =
    [1, 10, 30, 60, 100, 500];

/*
 * K19 — cho phep chay thu mot vai kich ban:  KICH_BAN=1,10
 * Khong dat bien thi chay du bay kich ban nhu cu.
 */
const SCENARIOS: number[] =
    process.env.KICH_BAN
        ? String(process.env.KICH_BAN)
            .split(",")
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((x: number) => SCENARIOS_MAC_DINH.indexOf(x) !== -1)
        : SCENARIOS_MAC_DINH;

/*
 * Header dung chung cho CA HAI dang file:
 *   gas_onchain_raw.csv    — gom ca 7 kich ban, phan biet bang cot `n`
 *   gas_onchain_n<N>.csv   — moi kich ban mot file
 * Tach thanh hang so de hai noi khong bao gio lech nhau.
 */
const CSV_HEADER =
    "mechanism,n,student_index,deploy_pool_gas,deploy_verifier_gas,"
    + "update_root_gas,verify_gas,verify_onchain_ms,withdraw_gas,"
    + "withdraw_ms,verify_record_gas,verify_record_ms,settle_gas,"
    + "settle_ms,root,nullifier\n";

/*
 * KHÔNG hằng số hoá amount ở đây.
 *
 * amount là public input thứ 3, đã nướng vào proof lúc sinh.
 * ShieldedPool.withdraw có require("amount differs from proof"),
 * nên số tiền gửi kèm giao dịch phải lấy từ chính calldata của
 * proof — dataset dùng amount nào thì phải rút đúng amount đó.
 *
 * Hằng hoá 0.01 ETH từng làm toàn bộ lượt chạy revert ở n = 1
 * với gasUsed 78 929 (chặn trước khi kịp gọi verifier).
 */


/*
 * `web3.currentProvider.request()` tra ve CA PHONG BI JSON-RPC
 * `{jsonrpc, id, result}` chu khong tra thang result ra.
 *
 * Truyen nguyen object do vao `evm_revert` se nhan:
 *   "Cannot wrap a \"object\" as a json-rpc type"
 * va — nguy hiem hon — neu khong boc result ra thi runner van chay tiep
 * voi chuoi CHUA duoc don. Da gap that khi kiem thu.
 */
async function callRpc(
    method: string,
    params: any[] = []
): Promise<any> {
    const response: any =
        await (web3.currentProvider as any).request({
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


/*
 * CHOT KIEM MOI TRUONG DO — spec D3.
 *
 * Kiem dung MOT dieu: vi trong dataset co PHAI la tai khoan Ganache khong.
 *
 * VI SAO DAY MOI LA DIEU KIEN DUNG:
 * `prepareExperimentInputs.ts` sinh dataset bang
 * `HDNodeWallet.fromPhrase(GANACHE_MNEMONIC, m/44'/60'/0'/0/{index})`
 * roi `assertGanacheAccountMatches` doi chieu voi `eth.getAccounts()`.
 * Tuc THIET KE la: vi sinh vien CHINH LA tai khoan Ganache. Runner dinh
 * tinh (K7) cung doi dung dieu nay.
 *
 * Ganache cap san 1000 ETH cho moi tai khoan => cac vi nay DA TON TAI tu
 * block 0. Nghia la:
 *   - khong lan withdraw nao phai tra phi tao tai khoan moi (EIP-161)
 *   - `withdraw_gas` chi co MOT bang duy nhat
 *   - trang thai thua tu mot luot chay bi giet KHONG lam lech ket qua,
 *     vi tai khoan da ton tai san roi
 *
 * ⚠️ Ban truoc cua chot nay doi so du = 0. SAI: no mo ta truong hop
 * Ganache chay mnemonic KHAC, luc do vi dataset thanh vi la va moi lan
 * rut bi cong them 25 000 gas tao tai khoan. Do la mot he do KHAC, khong
 * phai he ma dataset duoc thiet ke cho.
 */
async function assertMeasurementEnvironment(
    addresses: string[]
) {
    const accounts: string[] =
        await web3.eth.getAccounts();

    const accountSet = new Set(
        accounts.map(
            (
                a: string
            ) => a.toLowerCase()
        )
    );

    const lac = addresses.filter(
        (
            dc: string
        ) => !accountSet.has(dc.toLowerCase())
    );

    if (lac.length > 0) {
        throw new Error(
            [
                "GANACHE KHONG DUNG MNEMONIC: "
                + lac.length + "/" + addresses.length
                + " vi trong dataset khong phai tai khoan Ganache.",
                "Vi dau tien khong khop: " + lac[0],
                "Dataset duoc sinh tu mnemonic"
                + " \"test test ... junk\", duong dan"
                + " m/44'/60'/0'/0/{index} — xem"
                + " prepareExperimentInputs.ts.",
                "Chay tiep se do NHAM he: vi dataset thanh vi la (so du"
                + " 0), moi lan withdraw bi cong them 25 000 gas phi tao tai"
                + " khoan EIP-161, va result qua khong so duoc voi thuc"
                + " nghiem dinh tinh.",
                "Cach sua: khoi lines lai Ganache:",
                "  ganache --wallet.mnemonic \"test test test test test"
                + " test test test test test test junk\""
                + " --wallet.totalAccounts 501"
            ].join("\n")
        );
    }
}

// =========================
// LOAD PROOFS
// =========================

const {
    runProver
} = require("../clients/prover/halo2ProverClient");

/*
 * K19 — 07/09/2026: doc tap commitment cua mot kich ban.
 *
 * VI SAO CAN: `updateRoot(root, commitments)` cong bo ca mang len
 * chuoi (V4). Ban truoc truyen mang RONG vi runner nay doc proof tu
 * `proofs_n*.json`, ma file do khong co truong `commitment`. Hau qua:
 * ONC do mot duong code KHAC voi ADV, `update_root_gas` hai nhanh
 * khong so duoc, va K1 mat y nghia.
 *
 * Nay tinh lai commitment tu `dataset_n*.json` — dung nguon ma ADV
 * dung (`runRust("commitment", note)`), nen hai nhanh chay dung cung
 * mot duong code.
 */
function loadCommitments(
    n: number,
    tepDataset?: string
): string[] {
    /*
     * LAP20 — thi nghiem theo d dung dataset rieng (cat n sinh vien dau,
     * `merkle_depth = d`) nam trong thu muc luot, khong phai
     * experiments/data/dataset_n<N>.json. Cho phep truyen thang duong dan;
     * khong truyen thi giu nguyen duong cu.
     */
    const file =
        tepDataset
        ?? path.resolve(
            PROJECT_ROOT,
            "experiments",
            "data",
            `dataset_n${n}.json`
        );

    const dataset =
        JSON.parse(
            fs.readFileSync(file, "utf8")
        );

    return dataset.students.map(
        (
            sv: any
        ) =>
            String(
                runProver("commitment", sv.note).commitment
            )
    );
}

function loadProofs(
    n: number
) {
    const file =
        path.resolve(
            RESULT_DIR,
            `proofs_n${n}.json`
        );

    return JSON.parse(
        fs.readFileSync(
            file,
            "utf8"
        )
    );
}

// =========================
// DEPLOY CONTRACT
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
// VERIFY GAS/TIME
// =========================

async function measureVerify(
    verifierAddress: string,
    proofData: any,
    from: string
) {
    const proofAndSignals =
        normalizeCalldata(
            proofData
        );

    // verification time bằng eth_call
    const t0 =
        performance.now();

    const callResult =
        await verifyProofByCall(
            verifierAddress,
            proofAndSignals
        );

    const verifyTimeMs =
        performance.now() - t0;

    // verification gas bằng transaction gọi trực tiếp verifier
    const estimatedGas =
        await web3.eth.estimateGas({
            from,
            to: verifierAddress,
            data: proofAndSignals
        });

    const receipt =
        await web3.eth.sendTransaction({
            from,
            to: verifierAddress,
            data: proofAndSignals,
            gas: Number(estimatedGas) + 100000
        });

    return {
        callResult,
        verifyTimeMs,
        verifyGas: Number(receipt.gasUsed)
    };
}

// =========================
// MOT KICH BAN
// =========================

/*
 * LAP20 — 14/09/2026: than vong lap kich ban cua `main` tach thanh ham de
 * runner lap lai `lap20Experiment.ts` do bang DUNG doan code nay, nho vay
 * so cua lap20 so duoc voi lo 12/09. Tung dong ben trong giu nguyen; chi
 * them hai tuy chon:
 *   - `verifierArtifact` — thi nghiem theo d deploy verifier cua depth d
 *   - `soWarmup`         — so lan warm-up truoc cac lan do that
 * Mac dinh ({}) thi hanh vi y het truoc.
 *
 * Snapshot/revert quanh CA kich ban van do NGUOI GOI lo (main, hoac lap20).
 */
type DongDo = {
    warmup: boolean;
    lan: number;
    dong: string;
};

type TuyChonKichBan = {
    verifierArtifact?: any;
    soWarmup?: number;
    datasetPath?: string;
};

async function doMotKichBan(
    n: number,
    proofs: any[],
    school: string,
    accounts: string[],
    tuyChon: TuyChonKichBan = {}
) {
    const verifierArtifact =
        tuyChon.verifierArtifact ?? VERIFIER_ARTIFACT;

    const soWarmup =
        tuyChon.soWarmup ?? 0;

    const dong: DongDo[] =
        [];

    if (proofs.length === 0) {
        throw new Error(
            `No proofs found for n=${n}`
        );
    }

    const firstProofAndSignals =
        normalizeCalldata(
            proofs[0]
        );

    const {
        root: scenarioRoot
    } =
        extractRootAndNullifier(
            firstProofAndSignals
        );

    // Vốn pool = đúng tổng amount của n proof, cộng 1 phần dư.
    // Lấy từ calldata chứ không từ hằng số, vì require
    // "insufficient pool" so với chính amount trong proof.
    const totalAmount =
        proofs.reduce(
            (
                cong: bigint,
                p: any
            ) => cong + BigInt(
                extractPublicInputs(
                    normalizeCalldata(p)
                ).amountWei
            ),
            BigInt(0)
        );

    const poolValue =
        (
            totalAmount
            + totalAmount / BigInt(n)
        ).toString();

    // =========================
    // DEPLOY VERIFIER
    // =========================

    const verifierDeploy =
        await deployContract(
            verifierArtifact,
            [],
            school
        );

    console.log(
        "Verifier:",
        verifierDeploy.address
    );

    console.log(
        "Verifier deploy gas:",
        verifierDeploy.gasUsed
    );

    // =========================
    // DEPLOY POOL
    // =========================
    //
    // Nếu ShieldedPool constructor của bạn là:
    // constructor(address _verifier) payable
    // thì giữ [verifierDeploy.address].
    //
    // Nếu constructor không nhận verifier,
    // đổi [verifierDeploy.address] thành [].
    //

    const poolDeploy =
        await deployContract(
            POOL_ARTIFACT,
            // V1(b) — 0 = khong cuong che menh gia (dataset nhieu muc).
            [verifierDeploy.address, "0"],
            school,
            poolValue
        );

    const pool =
        poolDeploy.instance;

    console.log(
        "Pool:",
        poolDeploy.address
    );

    console.log(
        "Pool deploy gas:",
        poolDeploy.gasUsed
    );

    // =========================
    // UPDATE ROOT ONE TIME
    // =========================

    /*
     * K19 — cong bo ca mang commitment, dung nhu luong that
     * (`approveRootService.ts:51`) va dung nhu ADV lam. Truoc
     * 07/09/2026 cho nay truyen mang rong nen hai nhanh do hai
     * duong code khac nhau.
     */
    const commitments = loadCommitments(n, tuyChon.datasetPath);

    const updateRootTx =
        await pool.methods.updateRoot(
            scenarioRoot,
            commitments
        ).send({
            from: school,
            gas: 30000000
        });

    const updateRootGas =
        Number(
            updateRootTx.gasUsed
        );

    console.log(
        "Root updated:",
        scenarioRoot
    );

    // =========================
    // VERIFY + WITHDRAW EACH PROOF
    // =========================

    /*
     * LAP20 — than vong lap cu tach thanh ham de warm-up va lan do that
     * chay DUNG CUNG mot doan code.
     */
    const doMotProof = async (
        proofData: any
    ) => {
        const proofAndSignals =
            normalizeCalldata(
                proofData
            );

        const {
            root,
            nullifier,
            amountWei
        } =
            extractPublicInputs(
                proofAndSignals
            );

        const recipient =
            proofData.address || accounts[2];

        // 1. Verify proof
        const verifyResult =
            await measureVerify(
                verifierDeploy.address,
                proofData,
                school
            );

        /*
         * ===== HAI THIET KE, CUNG MOT TRANG THAI CHUOI =====
         *
         * Ca thiet ke GOP lan thiet ke TACH deu tieu `nullifier` nay,
         * nen khong chay noi tiep nhau tren cung mot chuoi duoc — cai
         * sau se revert voi "nullifier already used".
         *
         * Chup snapshot TRUOC, do thiet ke TACH, revert ve dung diem
         * do, roi do thiet ke GOP. Hai so vi the do tren trang thai
         * GIONG HET nhau — so du pool, tuoi tai khoan nguoi nhan,
         * lich su root deu y het — nen tru duoc cho nhau.
         *
         * Snapshot nay LONG BEN TRONG snapshot cua vong kich ban o
         * tren. Ganache cho phep long; revert cai trong khong dung
         * toi cai ngoai. Nhung `evm_revert` TIEU LUON snapshot da
         * dung, nen phai chup moi cho tung proof.
         */
        const proofSnapshotId =
            await callRpc("evm_snapshot");

        if (!proofSnapshotId) {
            throw new Error(
                "Ganache khong tra ve snapshot id truoc proof"
                + " student_index=" + proofData.student_index
                + " (n = " + n + "). Khong do duoc hai thiet ke tren"
                + " cung mot trang thai => verify_record_gas +"
                + " settle_gas khong so duoc voi withdraw_gas."
                + " Dung lai thay vi cho ra so sai."
            );
        }

        // 2a. THIET KE TACH — giai doan 1: xac minh va ghi nhan
        const tVerifyRecord =
            performance.now();

        const verifyRecordResult =
            await verifyAndRecordWithProofData(
                pool,
                proofData,
                recipient,
                amountWei,
                school
            );

        const verifyRecordTimeMs =
            performance.now() - tVerifyRecord;

        // 2b. THIET KE TACH — giai doan 2: duyet va chi
        const tSettle =
            performance.now();

        const settleResult =
            await settleByNullifier(
                pool,
                nullifier,
                school
            );

        const settleTimeMs =
            performance.now() - tSettle;

        // Tra chuoi ve dung diem truoc khi do thiet ke TACH.
        const proofReverted =
            await callRpc("evm_revert", [proofSnapshotId]);

        if (proofReverted !== true) {
            throw new Error(
                "evm_revert tra ve " + JSON.stringify(proofReverted)
                + " sau thiet ke tach (n = " + n + ", student_index = "
                + proofData.student_index + "). Nullifier VAN dang bi"
                + " danh dau, nen `withdraw` ngay sau se revert va"
                + " withdraw_gas thanh so rac. Dung lai."
            );
        }

        // 3. THIET KE GOP — mot giao dich lam ca hai viec
        const tWithdraw =
            performance.now();

        const withdrawResult =
            await withdrawWithProofData(
                pool,
                proofData,
                recipient,
                amountWei,
                school
            );

        const withdrawTimeMs =
            performance.now() - tWithdraw;

        console.log(
            [
                `n=${n}`,
                `student_index=${proofData.student_index}`,
                `verifyGas=${verifyResult.verifyGas}`,
                `withdrawGas=${withdrawResult.gasUsed}`,
                `verifyRecordGas=${verifyRecordResult.gasUsed}`,
                `settleGas=${settleResult.gasUsed}`
            ].join(", ")
        );

        return [
            "onchain",
            n,
            proofData.student_index,
            poolDeploy.gasUsed,
            verifierDeploy.gasUsed,
            updateRootGas,
            verifyResult.verifyGas,
            verifyResult.verifyTimeMs.toFixed(6),
            withdrawResult.gasUsed,
            withdrawTimeMs.toFixed(6),
            Number(verifyRecordResult.gasUsed),
            verifyRecordTimeMs.toFixed(6),
            Number(settleResult.gasUsed),
            settleTimeMs.toFixed(6),
            root,
            nullifier
        ].join(",");
    };

    /*
     * LAP20 — warm-up: `soWarmup` lan do tron bo (verify + tach + gop) tren
     * proof `w % n`, MOI LAN mot snapshot rieng roi revert ngay. Nullifier
     * cua warm-up khong duoc de lai, neu khong lan sau (hoac lan do that) cua
     * cung sinh vien se revert "nullifier already used".
     *
     * ⚠️ Snapshot phai theo TUNG lan, khong chung ca vong: khi n < soWarmup
     * (n = 1) cac lan warm-up dung CUNG mot nullifier. Ban dau dung mot
     * snapshot chung — nhanh ADV revert ngay luot dau o n = 1 (gap that 14/09
     * 18:35). Cac lan do that khong doi: chung luon bat dau tu trang thai
     * truoc warm-up.
     */
    for (
        let w = 0;
        w < soWarmup;
        w += 1
    ) {
        const warmupSnapshotId =
            await callRpc("evm_snapshot");

        if (!warmupSnapshotId) {
            throw new Error(
                "Ganache khong tra ve snapshot id truoc warm-up (n = "
                + n + "). Dung lai."
            );
        }

        console.log(
            `warm-up ${w + 1}/${soWarmup}`
        );

        dong.push({
            warmup:
                true,

            lan:
                w + 1,

            dong:
                await doMotProof(
                    proofs[w % proofs.length]
                )
        });

        const warmupReverted =
            await callRpc("evm_revert", [warmupSnapshotId]);

        if (warmupReverted !== true) {
            throw new Error(
                "evm_revert sau warm-up tra ve "
                + JSON.stringify(warmupReverted)
                + " (n = " + n + "). Nullifier warm-up VAN con. Dung lai."
            );
        }
    }

    for (
        let i = 0;
        i < proofs.length;
        i += 1
    ) {
        dong.push({
            warmup:
                false,

            lan:
                soWarmup + i + 1,

            dong:
                await doMotProof(
                    proofs[i]
                )
        });
    }

    return {
        dong,

        verifierDeployGas:
            verifierDeploy.gasUsed,

        poolDeployGas:
            poolDeploy.gasUsed,

        updateRootGas
    };
}

// =========================
// MAIN
// =========================

async function main() {
    fs.mkdirSync(
        RESULT_DIR,
        {
            recursive: true
        }
    );

    const accounts =
        await web3.eth.getAccounts();

    const school =
        accounts[0];

    // Chot kiem nen sach — gom dia chi nguoi nhan cua MOI kich ban.
    const allAddresses = Array.from(
        new Set(
            SCENARIOS.flatMap(
                (
                    n: number
                ) => loadProofs(n).map(
                    (
                        p: any
                    ) => p.address
                )
            )
        )
    ).filter(Boolean) as string[];

    await assertMeasurementEnvironment(allAddresses);

    console.log(
        "Moi school do dung: " + allAddresses.length
        + " vi dataset deu la tai khoan Ganache."
    );

    const csvPath =
        path.resolve(
            RESULT_DIR,
            "gas_onchain_raw.csv"
        );

    /*
     * DOI 2026-08-25 — them 4 cot cua THIET KE TACH.
     *
     * `withdraw_gas`       thiet ke GOP   — mot giao dich lam ca hai viec
     * `verify_record_gas`  thiet ke TACH, giai doan 1 — RIENG phan xac minh
     * `settle_gas`         thiet ke TACH, giai doan 2 — RIENG phan chi tien
     *
     * `settle_gas` la cot SO SANH DUOC voi `withdrawOffChain_gas` cua nhanh
     * off-chain: cung mot cong viec (kiem root, danh dau nullifier, chuyen
     * tien), khac o cho nhanh nay da co bang chung xac minh nam san tren
     * chuoi. Hieu (verify_record_gas) chinh la GIA cua viec xac minh
     * on-chain — con so trung tam cua Dong gop 2.
     *
     * CA HAI cung do tren CUNG MOT trang thai chuoi (snapshot/revert quanh
     * moi proof), nen cong duoc va tru duoc.
     */
    let csv = CSV_HEADER;

    for (const n of SCENARIOS) {
        /*
         * RESET TRẠNG THÁI CHUỖI TRƯỚC MỖI KỊCH BẢN — spec Đ3 / mục 5.2.
         *
         * Sáu dataset dùng chung dãy ví (`dataset_n10` lấy đúng 5 ví của
         * `dataset_n5` rồi thêm 5 ví mới). Chạy lần lượt trên cùng một
         * chain thì tới kịch bản sau, các ví đầu ĐÃ nhận tiền rồi nên rẻ
         * hơn ~25 000 gas (phí tạo tài khoản EIP-161).
         *
         * Hậu quả nếu không reset: trung bình theo n trông như GIẢM DẦN
         * (515k → 503k ở lượt 2026-08-16) ⇒ người đọc kết luận "n càng
         * lớn gas càng rẻ", sai hoàn toàn. Con số còn phụ thuộc THỨ TỰ
         * CHẠY nên lượt chạy không tái lập được.
         *
         * `evm_revert` TIÊU LUÔN snapshot, nên phải chụp mới ở đầu mỗi
         * vòng — dùng lại cùng một id lần hai sẽ trả `false` và chuỗi
         * không hề được dọn, mà runner thì vẫn chạy tiếp.
         */
        const snapshotId =
            await callRpc("evm_snapshot");

        if (!snapshotId) {
            throw new Error(
                "Ganache khong tra ve snapshot id truoc n = " + n
                + ". Khong reset duoc giua cac kich ban => withdraw_gas"
                + " se nhiem thu tu chay. Dung lai thay vi cho ra so sai."
            );
        }

        console.log(
            `\n==============================`
        );
        console.log(
            `Scenario n = ${n}`
        );
        console.log(
            `==============================`
        );

        const ketQuaKichBan =
            await doMotKichBan(
                n,
                loadProofs(
                    n
                ),
                school,
                accounts
            );

        csv += ketQuaKichBan.dong
            .filter(
                (d: DongDo) => !d.warmup
            )
            .map(
                (d: DongDo) => d.dong + "\n"
            )
            .join("");

        // Ghi lại sau MỖI kịch bản, không đợi hết vòng.
        // n = 500 là kịch bản cuối và lâu nhất; nếu nó hỏng thì
        // 6 kịch bản trước vẫn phải còn trên đĩa.
        fs.writeFileSync(
            csvPath,
            csv
        );

        /*
         * THEM 2026-08-31 — ghi THEM file rieng cho tung kich ban.
         *
         * Truoc day chi co MOT `gas_onchain_raw.csv` gom ca 7 muc, phan
         * biet bang cot `n`. Trong khi nhanh do hieu nang lai tach 7 file
         * `performance_onchain_n<N>.csv`. Hai kieu khac nhau trong cung
         * mot thu muc — kho doi chieu, de nham.
         *
         * Nay ghi CA HAI:
         *   gas_onchain_raw.csv    <- file GOC, giu nguyen, de doi chieu tong
         *   gas_onchain_n<N>.csv   <- moi kich ban mot file, khop kieu
         *                             `performance_onchain_n<N>.csv`
         *
         * Cung mot du lieu, chi khac cach chia. Khong co so nao doi.
         */
        const dongCuaKichBan =
            csv
                .trim()
                .split("\n")
                .slice(1)
                .filter((dong: string) =>
                    dong.split(",")[1] === String(n)
                );

        const csvPathTheoN =
            path.resolve(
                RESULT_DIR,
                `gas_onchain_n${n}.csv`
            );

        fs.writeFileSync(
            csvPathTheoN,
            CSV_HEADER + dongCuaKichBan.join("\n") + "\n"
        );

        console.log(
            `Đã ghi ${n} -> ${csvPath}`
            + ` và ${csvPathTheoN}`
            + ` (${dongCuaKichBan.length} dòng)`
        );

        const daRevert =
            await callRpc("evm_revert", [snapshotId]);

        if (daRevert !== true) {
            throw new Error(
                "evm_revert tra ve " + JSON.stringify(daRevert)
                + " sau n = " + n + " (mong doi true). Chuoi CHUA duoc"
                + " don, nen kich ban ke tiep se do sai. Dung lai."
            );
        }

        console.log(
            `Đã revert chuỗi về trạng thái sạch sau n = ${n}`
        );
    }

    console.log(
        "\nGas benchmark finished."
    );

    console.log(
        `Saved: ${csvPath}`
    );
}

module.exports = {
    doMotKichBan,
    loadCommitments,
    callRpc,
    assertMeasurementEnvironment,
    CSV_HEADER
};

/*
 * LAP20 — chi chay `main` khi goi truc tiep. `lap20Experiment.ts`
 * require file nay de dung lai `doMotKichBan`.
 */
if (require.main === module) {
    main().catch(
        (error: any) => {
            console.error(error);
            process.exit(1);
        }
    );
}
