/*
 * THỰC NGHIỆM ĐỊNH LƯỢNG — NHÁNH OFF-CHAIN (ADV)
 *
 * Đối ứng với zk-halo2-onchain: generateAllProofs.ts + benchmarkGas.ts.
 * Chạy trên CÙNG bộ dataset_n*.json đã chép từ nhánh on-chain, nên hai
 * nhánh đo trên đúng cùng những sinh viên — bài được phép nói "cùng đầu
 * vào", điều mà lượt định tính trước đây KHÔNG được phép nói.
 *
 * Đo bốn thứ, mỗi thứ ứng với một mục C còn thiếu:
 *
 *   C-1  thời gian sinh proof   -> prove_ms (tách khỏi setup_ms)
 *   C-2  thời gian xác thực     -> verify_ms (tách khỏi setup_ms)
 *   C-3  gas rút                -> withdrawOffChain
 *   C-5  gas triển khai         -> deploy ShieldedPool
 *
 * Khác biệt bản chất so với nhánh on-chain, KHÔNG được làm mờ khi viết bài:
 * ADV không có hợp đồng verifier, nên deploy_verifier_gas = 0 và
 * verify_gas = 0. Đó không phải "rẻ hơn" — proof không hề được hợp đồng
 * kiểm; niềm tin dịch sang backend. Xem reports/anonymity_offchain.md và khối
 * rangBuocAmountMucContract_C3 của thực nghiệm định tính.
 *
 * Chạy:
 *   npm run experiment:quantitative
 *
 * Cần: Ganache trên 127.0.0.1:8545, target/release/prover.exe đã build.
 * KHÔNG cần MongoDB, KHÔNG cần IPFS — runner này không đụng tới hai thứ đó.
 */

/*
 * Từ Node 19, agent HTTP toàn cục bật keepAlive và TÁI SỬ DỤNG socket cũ.
 *
 * Runner này gọi prover bằng spawnSync — mỗi proof chặn event loop hơn
 * một giây, và một kịch bản chạy hàng chục lần liên tiếp mà không đụng
 * tới RPC. Ganache đóng socket nhàn rỗi trong lúc đó; lời gọi RPC kế
 * tiếp vớ phải socket đã chết và nhận ECONNRESET dù Ganache vẫn sống.
 *
 * Tắt keepAlive => mỗi lời gọi RPC mở kết nối mới => bị chặn bao lâu
 * cũng không sao. Đã kiểm chứng ở anonymityExperiment.ts: chặn 15/20/25
 * giây đều qua, trong khi bật keepAlive thì hỏng ngay từ mốc 15 giây.
 */
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

const {
    runRust
} = require("../clients/prover/halo2ProverClient");

const {
    duongMerkleTuMang
} = require("../utils/merklePath");

const web3 =
    new Web3(
        "http://127.0.0.1:8545"
    );

// =========================
// ĐƯỜNG DẪN
// =========================

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const DATA_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/data"
    );

const RESULT_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/results/quantitative"
    );

const POOL_ARTIFACT =
    require(
        path.resolve(
            PROJECT_ROOT,
            "contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json"
        )
    );

// =========================
// CẤU HÌNH
// =========================

/*
 * Mặc định chạy cả 6 mức. Đặt KICH_BAN để chạy thử một phần,
 * ví dụ KICH_BAN=1,5 khi muốn kiểm nhanh trước lượt chạy thật.
 * Lượt chạy chính thức phải để trống biến này.
 */
const SCENARIOS: number[] =
    process.env.KICH_BAN
        ? String(
            process.env.KICH_BAN
        )
            .split(",")
            .map(
                (
                    x: string
                ) => Number(
                    x.trim()
                )
            )
        : [1, 10, 30, 60, 100, 500];

/*
 * Header dùng chung cho CẢ HAI dạng file gas:
 *   gas_offchain_raw.csv    — gộp cả 7 kịch bản, phân biệt bằng cột `n`
 *   gas_offchain_n<N>.csv   — mỗi kịch bản một file
 * Tách thành hằng số để hai nơi không bao giờ lệch nhau.
 *
 * ⚠️ Nhánh này KHÔNG có `verify_record_gas` / `settle_gas` — thiết kế tách
 * chỉ tồn tại ở ONC. Cột so sánh được với ONC `settle_gas` là `withdraw_gas`.
 */
const CSV_GAS_HEADER =
    "mechanism,n,student_index,deploy_pool_gas,deploy_verifier_gas,"
    + "update_root_gas,verify_gas,verify_onchain_ms,withdraw_gas,"
    + "withdraw_ms,root,nullifier\n";

/*
 * LAP20 — header file hiệu năng, tách thành hằng số để runner lặp lại
 * `lap20Experiment.ts` ghi ĐÚNG cùng bộ cột. Nội dung không đổi.
 */
const CSV_HIEU_NANG_HEADER =
    "mechanism,n,student_index,witness_ms,setup_ms,prove_ms,proof_generation_ms,verify_native_ms,verified,proof_bytes,calldata_bytes,root,nullifier,verify_setup_ms\n";

/*
 * KHÔNG hằng số hoá amount.
 *
 * amount là public input đã nướng vào proof. Bên on-chain từng hằng hoá
 * 0.01 ETH và làm cả lượt chạy revert ở n = 1 vì dataset dùng 2 wei.
 * Ở đây hợp đồng không kiểm proof nên sẽ KHÔNG revert — nó sẽ lặng lẽ
 * chi sai số tiền. Im lặng còn tệ hơn revert, nên vẫn lấy từ dataset.
 */

function buoc(
    thongDiep: string
) {
    process.stderr.write(
        "  " + thongDiep + "\n"
    );
}

/*
 * Tắt keepAlive đã xử lý nguyên nhân gốc, nhưng vẫn bọc thử lại cho
 * các lời gọi RPC: n = 100 chạy 200 lần spawn trước khi chạm chuỗi,
 * và một lượt chạy hỏng ở kịch bản cuối là mất rất nhiều thời gian.
 */
async function retry<T>(
    ten: string,
    viec: () => Promise<T>,
    soLan = 4
): Promise<T> {
    let loiCuoi: any = null;

    for (
        let i = 1;
        i <= soLan;
        i += 1
    ) {
        try {
            return await viec();
        } catch (error: any) {
            const ma =
                String(
                    error?.code
                    || error?.cause?.code
                    || error?.message
                    || ""
                );

            const laLoiKetNoi =
                /ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT|EPIPE/i
                    .test(ma);

            loiCuoi = error;

            if (
                !laLoiKetNoi
                || i === soLan
            ) {
                throw error;
            }

            buoc(
                "lỗi kết nối ở \"" + ten + "\" (lần " + i
                + "/" + soLan + "), chờ 3 giây rồi thử lại"
            );

            await new Promise(
                (
                    r
                ) => setTimeout(
                    r,
                    3000
                )
            );
        }
    }

    throw loiCuoi;
}


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
// ĐỌC DATASET
// =========================

function readDataset(
    n: number
) {
    const duongDan =
        path.resolve(
            DATA_DIR,
            `dataset_n${n}.json`
        );

    if (
        !fs.existsSync(
            duongDan
        )
    ) {
        throw new Error(
            `Thiếu dataset: ${duongDan}`
        );
    }

    return JSON.parse(
        fs.readFileSync(
            duongDan,
            "utf8"
        )
    );
}

// =========================
// TRIỂN KHAI HỢP ĐỒNG
// =========================

async function trienKhaiPool(
    from: string,
    value: string
) {
    const contract =
        new web3.eth.Contract(
            POOL_ARTIFACT.abi
        );

    const deployTx =
        contract.deploy({
            data:
                POOL_ARTIFACT.bytecode,

            /*
             * V1(b) — `poolDenomination = 0` nghia la KHONG cuong che
             * menh gia. Bo dataset dinh luong co nhieu muc tien khac
             * nhau, nen cuong che se lam moi luot rut revert.
             */
            arguments:
                ["0"]
        });

    const estimatedGas =
        await deployTx.estimateGas({
            from,
            value
        });

    let receipt: any =
        null;

    const instance =
        await deployTx
            .send({
                from,

                value,

                gas:
                    Number(
                        estimatedGas
                    ) + 1000000
            })
            .on(
                "receipt",
                (
                    r: any
                ) => {
                    receipt = r;
                }
            );

    return {
        instance,

        address:
            instance
                .options
                .address,

        gasUsed:
            Number(
                receipt.gasUsed
            )
    };
}

// =========================
// MỘT KỊCH BẢN
// =========================

/*
 * LAP20 (14/09/2026) — tuỳ chọn cho runner lặp lại `lap20Experiment.ts`.
 * Mặc định ({}) thì hành vi Y HỆT trước: không warm-up, ghi file vào
 * RESULT_DIR, đọc dataset theo n. Mọi đồng hồ giữ NGUYÊN vị trí — lap20
 * đo bằng CHÍNH hàm này để số so được với lô 12/09.
 */
type DongDo = {
    warmup: boolean;
    lan: number;
    dong: string;
};

type TuyChonKichBan = {
    dataset?: any;
    soWarmup?: number;
    ghiTepVaoResultDir?: boolean;

    /*
     * LAP20 (17/09/2026) — CHẾ ĐỘ NÓNG.
     *
     * `true` ⇒ sinh cả lượt bằng MỘT tiến trình `prove-batch`: keygen một
     * lần, rồi n proof trong vòng lặp nóng, verify ngay trong tiến trình đó.
     * Đúng điều kiện đo của nhánh ONC (`bench-from-dataset`), để hai cột
     * `setup_ms` đặt cạnh nhau được.
     *
     * 🔴 KHÔNG đặt ⇒ hành vi y hệt trước: mỗi proof một tiến trình `prove`,
     * mỗi lần xác thực một tiến trình `verify`. Đó là đường đã sinh ra lô
     * 12/09 và lô nguội, và nó không đổi một dòng nào.
     *
     * 🔴 Đây KHÔNG phải luồng thật — luồng rút tiền thật của cả hai nhánh
     * vẫn mở tiến trình mới mỗi lượt. Xem `PLAN_ALIGN_MEASUREMENT_CONDITIONS.md`.
     */
    cheDoNong?: boolean;
};

async function chayMotKichBan(
    n: number,
    school: string,
    tuyChon: TuyChonKichBan = {}
) {
    const soWarmup =
        tuyChon.soWarmup ?? 0;

    const dongHieuNang: DongDo[] =
        [];

    const dongGas: DongDo[] =
        [];
    console.log(
        `\n==============================`
    );

    console.log(
        `Kịch bản n = ${n}`
    );

    console.log(
        `==============================`
    );

    const dataset =
        tuyChon.dataset
        ?? readDataset(
            n
        );

    const sinhVien =
        dataset.students;

    // -------------------------
    // 1. Commitment cho từng sinh viên
    // -------------------------
    //
    // Phải có đủ n commitment trước khi sinh proof, vì mỗi proof cần
    // toàn bộ lá của cây để dựng đường Merkle.

    buoc(
        `tính ${n} commitment`
    );

    const commitments: string[] =
        sinhVien.map(
            (
                sv: any
            ) => {
                const result =
                    runRust(
                        "commitment",
                        {
                            student_id:
                                sv.note.student_id,

                            amount:
                                String(
                                    sv.note.amount
                                ),

                            rho:
                                String(
                                    sv.note.rho
                                )
                        }
                    );

                return result.commitment;
            }
        );

    /*
     * K10 — 03/09/2026: dựng cây MỘT LẦN cho cả kịch bản.
     *
     * Trước đây mỗi lượt `prove` nhận cả mảng `commitments`
     * nên prover chèn lại n lá — n × depth phép băm MỖI proof,
     * tức n² × depth cho cả kịch bản. Bây giờ gọi mode `root`
     * một lần để lấy các nút, rồi suy đường Merkle của từng
     * sinh viên bằng `duongMerkleTuMang` (chỉ tra bảng).
     *
     * Đây đúng là việc luồng thật làm sau K10: `approveRoot`
     * lưu cây, `createWithdrawalRequest` đọc `depth` nút.
     * Không sửa chỗ này thì phép đo không phản ánh bản sửa.
     */
    const cayKichBan =
        runRust(
            "root",
            {
                commitments
            }
        );

    const coCayLuuSan =
        Array.isArray(cayKichBan?.nodes)
        &&
        Array.isArray(cayKichBan?.zeros);

    console.error(
        coCayLuuSan
            ? "  cây dựng 1 lần — "
                + String(cayKichBan.nodes.length)
                + " tầng"
            : "  prover không trả nodes — dựng lại mỗi proof"
    );

    // -------------------------
    // 2. Sinh proof + xác thực từng sinh viên
    // -------------------------

    let csvHieuNang =
        CSV_HIEU_NANG_HEADER;

    const proofs: any[] =
        [];

    /*
     * LAP20 — thân vòng lặp cũ tách thành hàm để warm-up và lần đo thật
     * chạy ĐÚNG CÙNG một đoạn code; từng dòng bên trong giữ nguyên.
     */
    /*
     * LAP20 (17/09/2026) — payload gửi cho prover, tách thành hàm để mode
     * `prove` (một sinh viên một tiến trình) và mode `prove-batch` (cả lượt
     * một tiến trình) dùng CHUNG một đoạn dựng đường Merkle. Nội dung từng
     * trường giữ nguyên từng dòng so với trước.
     */
    const payloadSinhVien = (
        i: number
    ) => {
        const sv =
            sinhVien[i];

        return {
            student_id:
                sv.note.student_id,

            amount:
                String(
                    sv.note.amount
                ),

            rho:
                String(
                    sv.note.rho
                ),

            ...(coCayLuuSan
                ? {
                    commitments: [],
                    ...duongMerkleTuMang(
                        i,
                        cayKichBan.nodes,
                        cayKichBan.zeros
                    )
                }
                : {
                    commitments
                }),

            merkle_index:
                i,
            // A25 — ví nhận = địa chỉ sinh viên trong dataset.
            recipient:
                sv.address
        };
    };

    const sinhVaXacThuc = (
        i: number
    ) => {
        const sv =
            sinhVien[i];

        const proof =
            runRust(
                "prove",
                payloadSinhVien(i)
            );

        // Xác thực off-chain, tiến trình riêng.
        // verify_ms không gồm nạp params / dựng vk — chúng nằm ở
        // setup_ms, đúng như mode `verify` của prover đã tách sẵn.
        const xacThuc =
            runRust(
                "verify",
                {
                    proof:
                        proof.proof,

                    root:
                        proof.root,

                    nullifier:
                        proof.nullifier,

                    amount:
                        proof.amount,
                    recipient:
                        proof.recipient
                }
            );

        const banGhi = {
            student_index:
                i,

            address:
                sv.address,

            amountWei:
                String(
                    sv.note.amount
                ),

            ...proof,

            verify_ms:
                xacThuc.verify_ms,

            verified:
                xacThuc.verified
        };

        const dong = [
            "offchain",
            n,
            i,
            proof.tree_and_witness_ms.toFixed(6),
            proof.setup_ms.toFixed(6),
            proof.prove_ms.toFixed(6),

            // proof_generation_ms = witness + prove.
            // KHONG cong setup_ms — day la QUY UOC DO (spec D1), giu cho cot
            // chinh so duoc giua cac lo, giua hai nhanh va voi Groth16.
            //
            // 🔴 Sua 16/09/2026: cau cu ghi setup_ms la "chi phi MOT LAN cua
            // ca he" la SAI voi he nay. Backend chay theo mo hinh tien trinh
            // mot lan, nen MOI luot rut deu sinh lai khoa — chinh vi vay cot
            // setup_ms o day co `cach_dem = moi_lan_do`. Chi phi that cua mot
            // luot rut la TONG hai cot. Xem LUOC_DO_CSV.md.
            (
                proof.tree_and_witness_ms
                + proof.prove_ms
            ).toFixed(6),

            xacThuc.verify_ms.toFixed(6),
            xacThuc.verified,
            proof.proof.length / 2,

            // calldata_bytes: nhanh nay KHONG dua proof len chuoi.
            // O TRONG, khong phai 0 (spec 5.3).
            "",

            proof.root,
            proof.nullifier,

            // Cột THÊM RIÊNG của nhánh này, đặt ở CUỐI để 13 cột đầu
            // vẫn khớp vị trí với hai nhánh kia (spec mục 4.1).
            //
            // ADV chạy mode `verify` trong một TIẾN TRÌNH RIÊNG nên phải
            // nạp lại params và dựng lại vk mỗi lần. Chi phí đó không
            // tồn tại ở hai nhánh kia, và KHÔNG được cộng vào
            // `verify_native_ms`.
            xacThuc.setup_ms.toFixed(6)
        ].join(",");

        return {
            banGhi,
            dong
        };
    };

    /*
     * LAP20 — warm-up: sinh + xác thực `soWarmup` lần (student_index =
     * w % n) TRƯỚC các lần đo thật. Dòng warm-up giữ trong `dongHieuNang`
     * (warmup = true) nhưng KHÔNG vào `proofs` và KHÔNG vào file của
     * RESULT_DIR. Mỗi proof của nhánh này là một tiến trình prover riêng,
     * nên warm-up chỉ làm nóng bộ nhớ đệm đọc file của hệ điều hành, KHÔNG
     * làm nóng chính tiến trình — phải ghi rõ điều này khi viết bài.
     */
    /*
     * LAP20 (17/09/2026) — CHẾ ĐỘ NÓNG.
     *
     * Một tiến trình `prove-batch` cho cả lượt: keygen MỘT lần, rồi
     * `soWarmup + n` proof trong vòng lặp nóng, verify ngay tại chỗ.
     * `soWarmup` bản ghi ĐẦU là warm-up — đúng quy ước của nhánh ONC, nơi
     * prover cũng ghi dòng warm-up ở đầu tệp.
     *
     * Không đặt `cheDoNong` thì `proofsCoSan` là `null` và hai vòng dưới
     * chạy y như cũ.
     */
    const proofsCoSan: any[] | null =
        tuyChon.cheDoNong
            ? []
            : null;

    if (proofsCoSan) {
        const thuTu: number[] = [];

        for (let w = 0; w < soWarmup; w += 1) {
            thuTu.push(w % sinhVien.length);
        }

        for (let i = 0; i < sinhVien.length; i += 1) {
            thuTu.push(i);
        }

        buoc(
            `chế độ nóng — MỘT tiến trình prove-batch cho ${soWarmup} warm-up`
            + ` + ${sinhVien.length} lần đo`
        );

        const lo =
            runRust(
                "prove-batch",
                thuTu.map((i: number) => payloadSinhVien(i))
            );

        if (
            !Array.isArray(lo?.proofs)
            || lo.proofs.length !== thuTu.length
        ) {
            throw new Error(
                `prove-batch trả ${lo?.proofs?.length} bản ghi,`
                + ` cần ${thuTu.length}`
            );
        }

        /*
         * `setup_ms` là MỘT giá trị cho cả lượt — ghi lại y nguyên trên mọi
         * dòng để giữ đúng số cột CSV. Script tổng hợp tự nhận ra đại lượng
         * hằng-trong-lượt và đếm một giá trị mỗi lượt (`cach_dem = moi_luot`),
         * đúng như nó đang làm với ONC.
         */
        lo.proofs.forEach((p: any, vt: number) => {
            const laWarmup =
                vt < soWarmup;

            const i =
                thuTu[vt] as number;

            const sv =
                sinhVien[i];

            const dong = [
                "offchain",
                n,
                i,
                p.tree_and_witness_ms.toFixed(6),
                lo.setup_ms.toFixed(6),
                p.prove_ms.toFixed(6),
                (
                    p.tree_and_witness_ms
                    + p.prove_ms
                ).toFixed(6),
                p.verify_native_ms.toFixed(6),
                p.verified,
                p.proof.length / 2,
                // calldata_bytes: nhánh này KHÔNG đưa proof lên chuỗi.
                "",
                p.root,
                p.nullifier,
                /*
                 * verify_setup_ms — ở chế độ nóng KHÔNG có chi phí này:
                 * vk đã nằm sẵn trong RAM từ lần keygen duy nhất, đúng như
                 * nhánh ONC. Để TRỐNG, không phải 0.
                 */
                ""
            ].join(",");

            dongHieuNang.push({
                warmup: laWarmup,
                lan: vt + 1,
                dong
            });

            if (!laWarmup) {
                csvHieuNang += dong + "\n";

                proofsCoSan.push({
                    student_index: i,

                    address:
                        sv.address,

                    amountWei:
                        String(sv.note.amount),

                    proof: p.proof,
                    root: p.root,
                    nullifier: p.nullifier,
                    amount: p.amount,
                    recipient: p.recipient,

                    tree_and_witness_ms: p.tree_and_witness_ms,
                    setup_ms: lo.setup_ms,
                    prove_ms: p.prove_ms,
                    total_ms:
                        p.tree_and_witness_ms
                        + lo.setup_ms
                        + p.prove_ms,

                    verify_ms: p.verify_native_ms,
                    verified: p.verified
                });
            }
        });

        proofs.push(...proofsCoSan);
    }

    for (
        let w = 0;
        w < (proofsCoSan ? 0 : soWarmup);
        w += 1
    ) {
        const i =
            w % sinhVien.length;

        buoc(
            `warm-up ${w + 1}/${soWarmup} (student_index ${i})`
        );

        dongHieuNang.push({
            warmup:
                true,

            lan:
                w + 1,

            dong:
                sinhVaXacThuc(i).dong
        });
    }

    for (
        let i = 0;
        i < (proofsCoSan ? 0 : sinhVien.length);
        i += 1
    ) {
        buoc(
            `proof ${i + 1}/${n}`
        );

        const {
            banGhi,
            dong
        } = sinhVaXacThuc(i);

        proofs.push(
            banGhi
        );

        csvHieuNang += dong + "\n";

        dongHieuNang.push({
            warmup:
                false,

            lan:
                soWarmup + i + 1,

            dong
        });
    }

    if (
        !proofsCoSan
        && tuyChon.ghiTepVaoResultDir !== false
    ) {
        fs.writeFileSync(
            path.resolve(
                RESULT_DIR,
                `performance_offchain_n${n}.csv`
            ),
            csvHieuNang
        );

        fs.writeFileSync(
            path.resolve(
                RESULT_DIR,
                `proofs_offchain_n${n}.json`
            ),
            JSON.stringify(
                proofs,
                null,
                2
            )
        );
    }

    // -------------------------
    // 3. Gas: triển khai + duyệt root + rút
    // -------------------------

    const totalAmount =
        proofs.reduce(
            (
                cong: bigint,
                p: any
            ) => cong + BigInt(
                p.amountWei
            ),
            BigInt(0)
        );

    const poolValue =
        (
            totalAmount
            + totalAmount / BigInt(n)
        ).toString();

    buoc(
        `triển khai pool, vốn ${poolValue} wei`
    );

    const poolDeploy =
        await retry(
            "triển khai pool",
            () => trienKhaiPool(
                school,
                poolValue
            )
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

    // Mọi proof của một kịch bản có chung root — cây giống nhau.
    const scenarioRoot =
        proofs[0].root;

    const updateRootTx: any =
        await retry(
            "duyệt root",
            // V4 — cong bo ca tap commitment. `commitments` la dung mang
            // da dung de dung cay o tren, cung ham, cung thu tu.
            () => pool
                .methods
                .updateRoot(
                    scenarioRoot,
                    commitments
                )
                .send({
                    from:
                        school,

                    gas:
                        500000
                })
        );

    const updateRootGas =
        Number(
            updateRootTx.gasUsed
        );

    console.log(
        "Root updated:",
        scenarioRoot
    );

    let csvGas =
        "";

    /*
     * LAP20 — thân vòng lặp rút cũ tách thành hàm, cùng lý do như bước 2.
     */
    const rutMotLan = async (
        p: any
    ) => {
        /*
         * withdraw_ms — spec Đ6.
         *
         * Đồng hồ đặt BÊN TRONG lambda của `retry`, không bọc ngoài.
         *
         * VÌ SAO: `retry` thử lại khi RPC lỗi, mà ECONNRESET là lỗi đã
         * biết là CÓ xảy ra thật (spawnSync chặn event loop => Ganache
         * đóng socket keep-alive). Bọc ngoài thì một lần thử lại cộng
         * hàng trăm ms vào withdraw_ms — thời gian đó không liên quan gì
         * tới cơ chế đang đo, và nhánh ONC không có vòng thử lại nên hai
         * bên sẽ đo hai thứ khác nhau.
         *
         * Đặt trong lambda: mỗi lần thử lại gán lại `tWithdraw`, nên con số
         * cuối cùng chỉ tính LẦN GỬI THÀNH CÔNG.
         */
        let tWithdraw =
            0;

        const withdraw: any =
            await retry(
                "rút cho sinh viên " + p.student_index,
                () => {
                    tWithdraw =
                        performance.now();

                    return pool
                        .methods
                        .withdrawOffChain(
                            p.root,
                            p.nullifier,
                            p.address,
                            p.amountWei
                        )
                        .send({
                            from:
                                school,

                            gas:
                                500000
                        });
                }
            );

        const withdrawTimeMs =
            performance.now() - tWithdraw;

        console.log(
            [
                `n=${n}`,
                `student_index=${p.student_index}`,
                `proveMs=${p.prove_ms.toFixed(1)}`,
                `verifyMs=${p.verify_ms.toFixed(1)}`,
                `withdrawGas=${withdraw.gasUsed}`
            ].join(", ")
        );

        return [
            "offchain",
            n,
            p.student_index,
            poolDeploy.gasUsed,

            /*
             * Ô TRỐNG, KHÔNG phải 0 — spec mục 5.3.
             *
             * Nhánh này không có hợp đồng verifier. `0` đọc thành
             * "deploy miễn phí" và che mất cái giá thật: hợp đồng
             * KHÔNG tự kiểm được proof. Ô trống nói đúng sự thật —
             * cơ chế không tồn tại.
             */
            "",

            updateRootGas,

            // Ô TRỐNG, cùng lý do: xác thực không diễn ra trên chuỗi.
            "",

            // verify_onchain_ms — cũng trống, không có contract để gọi.
            // Thời gian verify native nằm ở `performance_offchain_n*.csv`
            // cột `verify_native_ms`, ĐỪNG nhầm hai cột này.
            "",
            Number(
                withdraw.gasUsed
            ),
            withdrawTimeMs.toFixed(6),
            p.root,
            p.nullifier
        ].join(",");
    };

    /*
     * LAP20 — warm-up rút tiền, MỖI LẦN một snapshot riêng rồi revert ngay:
     * nullifier của lần warm-up không được để lại, nếu không lần sau (hoặc
     * lần đo thật) của cùng sinh viên sẽ bị chặn vì nullifier đã dùng.
     *
     * ⚠️ Snapshot phải theo TỪNG lần, không chung cả vòng: khi n < soWarmup
     * (n = 1) các lần warm-up rút CÙNG một nullifier. Bản đầu dùng một
     * snapshot chung — lần warm-up thứ hai revert ngay lượt đầu ở n = 1
     * (gặp thật 14/09 18:35). Các lần đo thật không đổi: chúng luôn bắt đầu
     * từ trạng thái trước warm-up.
     */
    for (
        let w = 0;
        w < soWarmup;
        w += 1
    ) {
        const snapshotWarmup =
            await callRpc("evm_snapshot");

        if (!snapshotWarmup) {
            throw new Error(
                "Ganache không trả snapshot id trước warm-up gas (n = "
                + n + "). Dừng lại."
            );
        }

        buoc(
            `warm-up rút ${w + 1}/${soWarmup}`
        );

        dongGas.push({
            warmup:
                true,

            lan:
                w + 1,

            dong:
                await rutMotLan(
                    proofs[w % proofs.length]
                )
        });

        const daRevertWarmup =
            await callRpc("evm_revert", [snapshotWarmup]);

        if (daRevertWarmup !== true) {
            throw new Error(
                "evm_revert sau warm-up gas trả về "
                + JSON.stringify(daRevertWarmup)
                + " (n = " + n + "). Nullifier warm-up VẪN còn. Dừng lại."
            );
        }
    }

    for (
        let i = 0;
        i < proofs.length;
        i += 1
    ) {
        const dong =
            await rutMotLan(
                proofs[i]
            );

        csvGas += dong + "\n";

        dongGas.push({
            warmup:
                false,

            lan:
                soWarmup + i + 1,

            dong
        });
    }

    return {
        csvGas,
        dongHieuNang,
        dongGas,
        proofs,
        commitments,

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
            recursive:
                true
        }
    );

    const accounts =
        await web3.eth.getAccounts();

    const school =
        accounts[0];

    // Chot kiem nen sach — gom dia chi cua MOI kich ban.
    const allAddresses = Array.from(
        new Set(
            SCENARIOS.flatMap(
                (
                    n: number
                ) => readDataset(n).students.map(
                    (
                        sv: any
                    ) => sv.address
                )
            )
        )
    ) as string[];

    await assertMeasurementEnvironment(allAddresses);

    console.log(
        "Moi school do dung: " + allAddresses.length
        + " vi dataset deu la tai khoan Ganache."
    );

    console.log(
        "Bắt đầu thực nghiệm định lượng off-chain..."
    );

    console.log(
        "School account:",
        school
    );

    const csvPath =
        path.resolve(
            RESULT_DIR,
            "gas_offchain_raw.csv"
        );

    let csvGas = CSV_GAS_HEADER;

    /*
     * RESET TRẠNG THÁI CHUỖI TRƯỚC MỖI KỊCH BẢN — spec Đ3 / mục 5.2.
     *
     * VÌ SAO BẮT BUỘC: sáu dataset dùng chung dãy ví (`dataset_n10` lấy
     * đúng 5 ví của `dataset_n5` rồi thêm 5 ví mới). Chạy lần lượt trên
     * cùng một chain thì tới kịch bản sau, các ví đầu ĐÃ nhận tiền rồi
     * nên rẻ hơn ~25 000 gas (phí tạo tài khoản EIP-161).
     *
     * Hậu quả nếu không reset: trung bình theo n trông như GIẢM DẦN
     * (515k → 503k ở lượt 2026-08-16), người đọc kết luận "n càng lớn
     * gas càng rẻ" — sai hoàn toàn. Con số còn phụ thuộc THỨ TỰ CHẠY
     * nên lượt chạy không tái lập được.
     *
     * Sau khi reset: mọi ví đều nhận lần đầu ⇒ một băng duy nhất ⇒
     * trung bình là con số có thật, và bảng phẳng qua sáu mức n.
     */
    for (const n of SCENARIOS) {
        /*
         * KHOÁ PHỤC HỒI — bỏ qua kịch bản ĐÃ chạy xong.
         *
         * Một kịch bản coi là xong khi có ĐỦ HAI file: `proofs_offchain`
         * (chứng minh đã sinh proof) và `gas_offchain_n<N>.csv` (chứng
         * minh đã đo gas xong). Thiếu một trong hai ⇒ chạy lại cả kịch bản.
         *
         * Đọc lại dòng gas từ file cũ để `gas_offchain_raw.csv` cuối lượt
         * vẫn đủ 7 kịch bản, dù lượt này chỉ chạy vài mức.
         *
         * 🔴 HẠN CHẾ — KHÁC nhánh ONC, KHOÁ NÀY KHÔNG PHÁT HIỆN ĐƯỢC ĐỔI
         * CẤU HÌNH.
         * ONC kiểm được vì `calldata_bytes` đổi theo depth và theo số public
         * input (3 296 ↔ 4 128 ↔ 4 352 sau A25); nhánh này thì `proof_bytes`
         * giữ nguyên 3 104 B qua cả A25 nên KHÔNG có dấu hiệu tự phát hiện —
         * đổi mạch thì phải xoá `proofs_offchain_n*.json` bằng tay.
         * ADV thì proof LUÔN 3 104 B ở mọi depth — kích thước do `K` quyết,
         * không do `MERKLE_DEPTH`. Nên không có dấu hiệu nào trong file để
         * biết nó sinh ở depth nào.
         *
         * ⇒ ĐỔI `MERKLE_DEPTH` (hoặc `K`) thì PHẢI XOÁ TAY toàn bộ
         *   `proofs_offchain_n*.json` + `gas_offchain_n*.csv` trước khi chạy,
         *   nếu không sẽ có bộ số TRỘN HAI CẤU HÌNH mà không ai hay.
         */
        const fileProof = path.resolve(
            RESULT_DIR,
            `proofs_offchain_n${n}.json`
        );

        const fileGasTheoN = path.resolve(
            RESULT_DIR,
            `gas_offchain_n${n}.csv`
        );

        if (
            fs.existsSync(fileProof)
            && fs.existsSync(fileGasTheoN)
        ) {
            const dongCu = fs
                .readFileSync(fileGasTheoN, "utf8")
                .trim()
                .split("\n")
                .slice(1);

            csvGas += dongCu.join("\n") + "\n";

            buoc(
                `BỎ QUA n = ${n} — đã có proof và gas`
                + ` (${dongCu.length} dòng đọc lại).`
                + ` Xoá proofs_offchain_n${n}.json nếu muốn chạy lại.`
            );

            continue;
        }

        /*
         * Chụp TRƯỚC, revert SAU mỗi kịch bản.
         *
         * `evm_revert` TIÊU LUÔN snapshot — dùng lại cùng một id lần
         * thứ hai sẽ trả `false` và chuỗi không hề được dọn, mà runner
         * thì vẫn chạy tiếp. Nên phải chụp mới ở đầu mỗi vòng.
         */
        const snapshotId = await callRpc("evm_snapshot");

        if (!snapshotId) {
            throw new Error(
                "Ganache không trả về snapshot id trước n = " + n
                + ". Không reset được giữa các kịch bản ⇒ withdraw_gas"
                + " sẽ nhiễm thứ tự chạy. Dừng lại thay vì cho ra số sai."
            );
        }

        csvGas += (
            await chayMotKichBan(
                n,
                school
            )
        ).csvGas;

        const daRevert = await callRpc("evm_revert", [snapshotId]);

        if (daRevert !== true) {
            throw new Error(
                "evm_revert trả về " + JSON.stringify(daRevert)
                + " sau n = " + n + " (mong đợi true). Chuỗi CHƯA được"
                + " dọn, nên kịch bản kế tiếp sẽ đo sai. Dừng lại."
            );
        }

        buoc(
            "đã revert chuỗi về trạng thái sạch sau n = " + n
        );

        // Ghi lại sau MỖI kịch bản. n = 500 lâu nhất và ở cuối;
        // nếu nó hỏng thì sáu kịch bản trước vẫn phải còn trên đĩa.
        fs.writeFileSync(
            csvPath,
            csvGas
        );

        /*
         * THÊM 2026-09-01 — ghi THÊM file riêng cho từng kịch bản.
         *
         * Trước đây chỉ có MỘT `gas_offchain_raw.csv` gộp cả 7 mức, trong
         * khi `performance_offchain_n<N>.csv` lại tách 7 file. Hai kiểu
         * khác nhau trong cùng thư mục — khó đối chiếu, dễ nhầm.
         *
         * Giữ NGUYÊN file gốc, chỉ ghi thêm. Cùng dữ liệu, khác cách chia.
         * Khớp với `gas_onchain_n<N>.csv` của nhánh ONC.
         */
        const dongCuaKichBan =
            csvGas
                .trim()
                .split("\n")
                .slice(1)
                .filter((dong: string) =>
                    dong.split(",")[1] === String(n)
                );

        const csvPathTheoN =
            path.resolve(
                RESULT_DIR,
                `gas_offchain_n${n}.csv`
            );

        fs.writeFileSync(
            csvPathTheoN,
            CSV_GAS_HEADER + dongCuaKichBan.join("\n") + "\n"
        );

        console.log(
            `Đã ghi ${n} -> ${csvPath}`
            + ` và ${csvPathTheoN}`
            + ` (${dongCuaKichBan.length} dòng)`
        );
    }

    console.log(
        "\nThực nghiệm định lượng off-chain hoàn tất."
    );

    console.log(
        `Saved: ${csvPath}`
    );
}

module.exports = {
    chayMotKichBan,
    assertMeasurementEnvironment,
    callRpc,
    readDataset,
    CSV_GAS_HEADER,
    CSV_HIEU_NANG_HEADER
};

/*
 * LAP20 — chỉ chạy `main` khi gọi trực tiếp. `lap20Experiment.ts`
 * require file này để dùng lại `chayMotKichBan`.
 */
if (require.main === module) {
    main().catch(
        (error: any) => {
            console.error(error);
            process.exit(1);
        }
    );
}
