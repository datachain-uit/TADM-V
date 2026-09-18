/*
 * KIỂM NGHIỆM TRÊN MẠNG THẬT (bậc 2) — nhánh OFF-CHAIN
 * ======================================================
 *
 * Câu hỏi cần trả lời: hệ có deploy và chạy trọn luồng được trên một mạng
 * Ethereum thật hay không. Đây là câu hỏi CÓ/KHÔNG, nên chỉ cần:
 *
 *   1. deploy ShieldedPool
 *   2. duyệt root với ĐỦ 500 commitment — giao dịch nặng nhất, và là chỗ
 *      EIP-7623 có thể làm đổi số gas so với Ganache
 *   3. rút cho 3 sinh viên ở đầu / giữa / cuối cây: 0, 250, 499
 *   4. dùng lại nullifier của sinh viên 0 — PHẢI bị từ chối
 *   5. dựng lại cây từ log CommitmentsPublished trên chuỗi, so với root
 *
 * Bytecode deploy chính là artifact đã đo; proof lấy từ `luot_bao_cao`. Từ A25
 * (12/09/2026) public input gồm [root, nullifier, amount, recipient] — vẫn
 * không có địa chỉ hợp đồng, nên proof đo trên Ganache dùng lại được trên
 * Sepolia. Proof đo TRƯỚC A25 (3 public input) bị chốt bên dưới từ chối:
 * phải đo lại định lượng trước khi kiểm nghiệm.
 *
 * Gas là tất định, nên số gas trên mạng thật PHẢI trùng dòng tương ứng trong
 * gas_offchain_n500.csv, trừ hai ngoại lệ biết trước:
 *   - updateRoot: sàn phí calldata của EIP-7623 (Prague). Ganache dừng ở
 *     Shanghai nên không có sàn này.
 *   - withdrawOffChain: +25 000 gas nếu địa chỉ nhận CHƯA TỪNG TỒN TẠI trên
 *     mạng đó (phí tạo tài khoản). Trên Ganache mọi ví đều có sẵn.
 * Script ghi đủ dữ liệu để giải thích từng chênh lệch, không tự ý sửa số.
 *
 * Gas limit được ƯỚC LƯỢNG, không cố định như runner định lượng (500 000):
 * sàn EIP-7623 của updateRoot n = 500 cao hơn 500 000, đặt cố định thì giao
 * dịch bị từ chối ngay. Gas limit không ảnh hưởng gasUsed.
 *
 * Biến môi trường (backend/.env — đã bị git chặn):
 *   KIEM_NGHIEM_RPC_URL      mặc định http://127.0.0.1:8545 (chạy thử Ganache)
 *   KIEM_NGHIEM_PRIVATE_KEY  bắt buộc trên mạng thật; trên máy cục bộ bỏ trống
 *                            thì dùng accounts[0] của GANACHE_MNEMONIC
 *   KIEM_NGHIEM_PROOFS       trỏ tới tệp proof khác `luot_bao_cao` (đường dẫn
 *                            tính từ gốc repo). Dùng khi lượt báo cáo vẫn là
 *                            proof TRƯỚC A25 (3 public input).
 *
 * Chạy:  npm run experiment:sepolia
 * Ghi:   experiments/results/sepolia/kiem_nghiem_<mạng>_<thời-điểm>.json
 */

// spawnSync lên prover chặn event loop — xem quantitativeExperiment.ts.
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "..", "..", ".env")
});

const { ethers } = require("ethers");

const {
    runRust
} = require("../clients/prover/halo2ProverClient");

const {
    ghiCsv
} = require("./sepoliaCsv");

// =========================
// CẤU HÌNH
// =========================

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

const N = 500;
const CHI_SO = [0, 250, 499];

const GANACHE_MNEMONIC =
    process.env.GANACHE_MNEMONIC
    || "test test test test test test test test test test test junk";

const RPC_URL =
    process.env.KIEM_NGHIEM_RPC_URL
    || "http://127.0.0.1:8545";

const PRIVATE_KEY =
    process.env.KIEM_NGHIEM_PRIVATE_KEY
    || "";

/*
 * Chỉ cho chạy trên máy cục bộ và Sepolia. Mainnet và mọi mạng khác bị chặn:
 * script này tiêu ETH và deploy hợp đồng công khai.
 */
const TEN_MANG: Record<string, string> = {
    "1337": "ganache",
    "31337": "hardhat",
    "11155111": "sepolia"
};

const EXPLORER: Record<string, string> = {
    "11155111": "https://sepolia.etherscan.io"
};

const THU_MUC_DO =
    path.join(PROJECT_ROOT, "experiments", "results", "quantitative", "luot_bao_cao");

const THU_MUC_RA =
    path.join(PROJECT_ROOT, "experiments", "results", "sepolia");

/*
 * Nguồn proof. Mặc định là lượt báo cáo — cùng lô đo sinh ra gas_offchain_n500.csv,
 * nên số gas đối chiếu được trực tiếp. KIEM_NGHIEM_PROOFS trỏ tới tệp khác khi
 * lượt báo cáo còn là proof TRƯỚC A25. Hợp đồng ADV không đổi ở A25, nên gas vẫn
 * so được; cái đổi là proof, và script tự ghi rõ điều đó (xem baseline_note).
 */
const TEP_PROOF =
    process.env.KIEM_NGHIEM_PROOFS
        ? path.resolve(PROJECT_ROOT, process.env.KIEM_NGHIEM_PROOFS)
        : path.join(THU_MUC_DO, `proofs_offchain_n${N}.json`);

const PROOF_CUNG_LUOT_DO = !process.env.KIEM_NGHIEM_PROOFS;

const POOL_ARTIFACT =
    require(
        path.join(PROJECT_ROOT, "contracts", "artifacts", "contracts", "ShieldedPool.sol", "ShieldedPool.json")
    );

/*
 * Gas dự trù để kiểm số dư TRƯỚC khi tiêu: deploy pool + updateRoot ở mức
 * sàn EIP-7623 + 3 lượt rút + 1 giao dịch dùng lại nullifier, cộng biên 30 %.
 */
const GAS_DU_TRU =
    BigInt(Math.ceil((968_565 + 700_000 + 3 * 90_000 + 100_000) * 1.3));

// =========================
// TIỆN ÍCH
// =========================

function laMayCucBo(url: string): boolean {
    return /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
}

function thoiDiem(): string {
    const d = new Date();
    const hai = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`
        + `T${hai(d.getHours())}-${hai(d.getMinutes())}-${hai(d.getSeconds())}`;
}

function docCsv(file: string): any[] {
    const dong =
        fs.readFileSync(file, "utf8")
            .split(/\r?\n/)
            .filter((l: string) => l.trim() !== "");

    const tieuDe = String(dong[0]).split(",");

    return dong.slice(1).map((l: string) => {
        const o: any = {};
        l.split(",").forEach((v: string, i: number) => {
            o[String(tieuDe[i])] = v;
        });
        return o;
    });
}

/*
 * EIP-7623 (Prague): gas của giao dịch >= 21 000 + 10 × token, với
 * token = số byte 0 + 4 × số byte khác 0 trong calldata.
 */
function phanTichCalldata(data: string) {
    const hex = data.startsWith("0x") ? data.slice(2) : data;

    let khong = 0;
    let khacKhong = 0;

    for (let i = 0; i < hex.length; i += 2) {
        if (hex.slice(i, i + 2) === "00") {
            khong += 1;
        } else {
            khacKhong += 1;
        }
    }

    const token = khong + 4 * khacKhong;

    return {
        calldata_bytes: khong + khacKhong,
        zero_bytes: khong,
        nonzero_bytes: khacKhong,
        tokens: token,
        standard_calldata_gas: 4 * khong + 16 * khacKhong,
        eip7623_floor_gas: 21_000 + 10 * token
    };
}

function lyDo(err: any): string {
    return String(
        err?.reason
        || err?.shortMessage
        || err?.info?.error?.message
        || err?.message
        || err
    );
}

function lienKet(chainId: string, hash: string): string | null {
    const goc = EXPLORER[chainId];
    return goc ? `${goc}/tx/${hash}` : null;
}

/*
 * Địa chỉ đã "tồn tại" theo nghĩa của EVM thì chuyển tiền tới không mất phí
 * tạo tài khoản. Ghi lại để giải thích chênh lệch +25 000 gas nếu có.
 */
async function trangThaiDiaChi(provider: any, diaChi: string) {
    const [soDu, nonce, ma] = await Promise.all([
        provider.getBalance(diaChi),
        provider.getTransactionCount(diaChi),
        provider.getCode(diaChi)
    ]);

    return {
        balance_wei: soDu.toString(),
        nonce: Number(nonce),
        has_code: ma !== "0x",
        existed: soDu > 0n || Number(nonce) > 0 || ma !== "0x"
    };
}

async function choBienNhan(tx: any) {
    const bn = await tx.wait();

    return {
        hash: String(tx.hash),
        block: Number(bn.blockNumber),
        gas_used: Number(bn.gasUsed),
        status: Number(bn.status)
    };
}

/*
 * Giao dịch PHẢI revert: trước hết staticCall để lấy lý do, rồi gửi thật
 * với gasLimit cố định (ước lượng sẽ thất bại vì revert) để có một giao dịch
 * thất bại NẰM TRÊN CHUỖI — ai có hash cũng tự tra được.
 */
async function guiPhaiRevert(
    ham: any,
    doiSo: any[],
    gasLimit: bigint,
    provider: any
) {
    let staticRevert = false;
    let lyDoRevert = "";

    try {
        await ham.staticCall(...doiSo);
    } catch (e: any) {
        staticRevert = true;
        lyDoRevert = lyDo(e);
    }

    let hash: string | null = null;
    let bn: any = null;
    let loiGui = "";

    try {
        const tx = await ham(...doiSo, { gasLimit });
        hash = String(tx.hash);

        try {
            bn = await tx.wait();
        } catch (e: any) {
            bn = e?.receipt || await provider.getTransactionReceipt(hash);
        }
    } catch (e: any) {
        // Có node từ chối ngay ở bước gửi — vẫn là bị từ chối, ghi lại lý do.
        loiGui = lyDo(e);
    }

    return {
        static_call_reverted: staticRevert,
        revert_reason: lyDoRevert,
        send_error: loiGui || null,
        hash,
        block: bn ? Number(bn.blockNumber) : null,
        status: bn ? Number(bn.status) : null,
        gas_used: bn ? Number(bn.gasUsed) : null
    };
}

// =========================
// MAIN
// =========================

async function main() {
    // ---------- 1. dữ liệu đã đo — tính cục bộ, KHÔNG tốn ETH ----------
    const dataset =
        JSON.parse(
            fs.readFileSync(
                path.join(PROJECT_ROOT, "experiments", "data", `dataset_n${N}.json`),
                "utf8"
            )
        );

    const proofs: any[] =
        JSON.parse(
            fs.readFileSync(TEP_PROOF, "utf8")
        );

    const moc: any[] =
        docCsv(path.join(THU_MUC_DO, `gas_offchain_n${N}.csv`));

    const sinhVien: any[] = dataset.students;

    console.error(`Tính ${sinhVien.length} commitment từ dataset ...`);

    const commitments: string[] =
        sinhVien.map((sv: any) =>
            String(
                runRust("commitment", {
                    student_id: sv.note.student_id,
                    amount: String(sv.note.amount),
                    rho: String(sv.note.rho)
                }).commitment
            )
        );

    const rootTinh = String(runRust("root", { commitments }).root).toLowerCase();
    const rootProof = String(proofs[0]?.root).toLowerCase();

    if (rootTinh !== rootProof) {
        throw new Error(
            `root tính lại ${rootTinh} khác root của proof ${rootProof} — dừng trước khi tiêu ETH`
        );
    }

    for (const i of CHI_SO) {
        const p = proofs.find((x: any) => x.student_index === i);

        if (!p) {
            throw new Error(`không có proof cho student_index ${i}`);
        }

        if (String(p.root).toLowerCase() !== rootProof) {
            throw new Error(`proof ${i} không cùng root với pool`);
        }

        // A25 — proof phải mang ví nhận, và đúng ví của sinh viên đó.
        if (!p.recipient || BigInt(p.recipient) !== BigInt(p.address)) {
            throw new Error(
                `proof ${i} không mang ví nhận ${p.address} — là proof đo TRƯỚC A25;`
                + " chạy lại định lượng (npm run experiment:quantitative) trước khi kiểm nghiệm"
            );
        }
    }

    // ---------- 2. kết nối, chặn mạng lạ, kiểm số dư ----------
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = String((await provider.getNetwork()).chainId);
    const tenMang = TEN_MANG[chainId];

    if (!tenMang) {
        throw new Error(`chainId ${chainId} không nằm trong danh sách cho phép (ganache / hardhat / sepolia)`);
    }

    const cucBo = laMayCucBo(RPC_URL);
    const viMacDinh = ethers.Wallet.fromPhrase(GANACHE_MNEMONIC);

    let vi: any;

    if (PRIVATE_KEY) {
        vi = new ethers.Wallet(PRIVATE_KEY, provider);
    } else if (cucBo) {
        vi = viMacDinh.connect(provider);
    } else {
        throw new Error("mạng thật cần KIEM_NGHIEM_PRIVATE_KEY trong backend/.env");
    }

    if (!cucBo && vi.address.toLowerCase() === viMacDinh.address.toLowerCase()) {
        throw new Error("không dùng ví của mnemonic công khai 'test … junk' trên mạng thật");
    }

    const tongTien: bigint =
        sinhVien.reduce((s: bigint, sv: any) => s + BigInt(sv.note.amount), 0n);

    // Giống runner định lượng: vốn = tổng + tổng / n.
    const vonPool = tongTien + tongTien / BigInt(N);

    const phi = await provider.getFeeData();
    const giaGas: bigint = phi.maxFeePerGas ?? phi.gasPrice ?? 0n;
    const soDu: bigint = await provider.getBalance(vi.address);
    const canCo = giaGas * GAS_DU_TRU + vonPool;

    console.error(
        `Mạng ${tenMang} (chainId ${chainId}) | ví ${vi.address}`
        + ` | số dư ${ethers.formatEther(soDu)} ETH | dự trù ${ethers.formatEther(canCo)} ETH`
    );

    if (soDu < canCo) {
        throw new Error(`số dư không đủ: cần khoảng ${ethers.formatEther(canCo)} ETH`);
    }

    // ---------- 3. deploy ----------
    console.error("Deploy ShieldedPool ...");

    const factory = new ethers.ContractFactory(POOL_ARTIFACT.abi, POOL_ARTIFACT.bytecode, vi);

    // V1(b): poolDenomination = 0 — giống runner định lượng.
    const pool: any = await factory.deploy("0", { value: vonPool });
    const trienKhai = await choBienNhan(pool.deploymentTransaction());
    const diaChiPool = String(await pool.getAddress());

    // ---------- 4. duyệt root với đủ 500 commitment ----------
    console.error(`Duyệt root với ${commitments.length} commitment ...`);

    const txRoot = await pool.updateRoot(rootProof, commitments);
    const duyetRoot = await choBienNhan(txRoot);
    const calldataRoot = phanTichCalldata(String(txRoot.data));

    const currentRoot = String(await pool.currentRoot()).toLowerCase();
    const rootHopLe = Boolean(await pool.validRoot(rootProof));

    // ---------- 5. rút cho 3 sinh viên ----------
    const luotRut: any[] = [];

    for (const i of CHI_SO) {
        const p = proofs.find((x: any) => x.student_index === i);

        // Nhánh off-chain: backend xác thực TRƯỚC khi gửi — làm đúng như vậy.
        const xacThuc =
            runRust("verify", {
                proof: p.proof,
                root: p.root,
                nullifier: p.nullifier,
                amount: p.amount,
                // A25 — ví nhận, public input thứ 4.
                recipient: p.recipient
            });

        if (xacThuc.verified !== true) {
            throw new Error(`proof ${i} không qua xác thực off-chain`);
        }

        const nguoiNhan = await trangThaiDiaChi(provider, p.address);

        console.error(`Rút cho sinh viên ${i} ...`);

        const tx = await pool.withdrawOffChain(p.root, p.nullifier, p.address, p.amountWei);
        const bn = await choBienNhan(tx);

        const dongMoc = moc.find((r: any) => Number(r.student_index) === i);
        const gasMoc = dongMoc ? Number(dongMoc.withdraw_gas) : null;

        luotRut.push({
            student_index: i,
            recipient: p.address,
            recipient_existed_before: nguoiNhan.existed,
            offchain_verified: true,
            offchain_verify_ms: xacThuc.verify_ms,
            tx: { ...bn, explorer: lienKet(chainId, bn.hash) },
            ganache_gas_used: gasMoc,
            delta_vs_ganache: gasMoc === null ? null : bn.gas_used - gasMoc,
            nullifier_marked_used: Boolean(await pool.usedNullifier(p.nullifier))
        });
    }

    // ---------- 6. dùng lại nullifier — phải bị từ chối ----------
    console.error("Dùng lại nullifier của sinh viên 0 ...");

    const p0 = proofs.find((x: any) => x.student_index === CHI_SO[0]);

    const dungLai =
        await guiPhaiRevert(
            pool.withdrawOffChain,
            [p0.root, p0.nullifier, p0.address, p0.amountWei],
            200_000n,
            provider
        );

    // ---------- 7. bên thứ ba dựng lại cây từ log trên chuỗi ----------
    console.error("Dựng lại cây từ log CommitmentsPublished ...");

    const suKien = pool.interface.getEvent("CommitmentsPublished");

    const logs =
        await provider.getLogs({
            address: diaChiPool,
            topics: [suKien.topicHash],
            fromBlock: duyetRoot.block,
            toBlock: duyetRoot.block
        });

    if (logs.length === 0) {
        throw new Error("không tìm thấy log CommitmentsPublished trên chuỗi");
    }

    const giaiMa = pool.interface.parseLog(logs[0]);
    const csTrenChuoi: string[] = Array.from(giaiMa.args.commitments).map((x: any) => String(x));
    const rootDungLai = String(runRust("root", { commitments: csTrenChuoi }).root).toLowerCase();

    // ---------- 8. kết luận + ghi bằng chứng ----------
    const gasDeployMoc = Number(moc[0]?.deploy_pool_gas);
    const gasRootMoc = Number(moc[0]?.update_root_gas);

    const tieuChi = {
        deployed: trienKhai.status === 1,
        root_approved: duyetRoot.status === 1 && currentRoot === rootProof && rootHopLe,
        all_withdrawals_succeeded: luotRut.every((r: any) => r.tx.status === 1 && r.nullifier_marked_used),
        replay_rejected: dungLai.static_call_reverted && (dungLai.status === 0 || dungLai.send_error !== null),
        root_rebuilt_from_chain_logs: rootDungLai === currentRoot && csTrenChuoi.length === N
    };

    const tatCaDat = Object.values(tieuChi).every(Boolean);

    const bangChung = {
        metadata: {
            mechanism: "offchain",
            measured_at_local: thoiDiem(),
            network: tenMang,
            chain_id: chainId,
            // Chỉ ghi host: URL của Infura/Alchemy chứa API key.
            rpc_host: new URL(RPC_URL).host,
            school_address: vi.address,
            n_pool: N,
            students_withdrawn: CHI_SO,
            reference_run: "experiments/results/quantitative/luot_bao_cao (09/09/2026, Ganache, Shanghai)",
            proof_source: path.relative(PROJECT_ROOT, TEP_PROOF).replace(/\\/g, "/"),
            baseline_same_circuit: PROOF_CUNG_LUOT_DO,
            baseline_note: PROOF_CUNG_LUOT_DO
                ? "proof và gas CSV cùng một lô đo — mọi delta_vs_ganache đều là số so sánh thật"
                : "gas_offchain_n500.csv là của lô đo 09/09 (TRƯỚC A25). Hợp đồng ADV không đổi"
                    + " nên deploy/update_root/withdraw vẫn so được; proof là bản mới, nên"
                    + " thời gian xác thực off-chain không so với lô cũ."
        },
        level2_criteria: tieuChi,
        level2_reached: tatCaDat && tenMang === "sepolia",
        contracts: {
            shielded_pool: diaChiPool,
            explorer: EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${diaChiPool}` : null
        },
        deploy_pool: {
            ...trienKhai,
            explorer: lienKet(chainId, trienKhai.hash),
            ganache_gas_used: gasDeployMoc,
            delta_vs_ganache: trienKhai.gas_used - gasDeployMoc
        },
        update_root: {
            ...duyetRoot,
            explorer: lienKet(chainId, duyetRoot.hash),
            commitments: commitments.length,
            ganache_gas_used: gasRootMoc,
            delta_vs_ganache: duyetRoot.gas_used - gasRootMoc,
            calldata: calldataRoot,
            gas_equals_eip7623_floor: duyetRoot.gas_used === calldataRoot.eip7623_floor_gas,
            current_root_on_chain: currentRoot,
            valid_root_on_chain: rootHopLe
        },
        withdrawals: luotRut,
        nullifier_replay: {
            student_index: CHI_SO[0],
            ...dungLai,
            explorer: dungLai.hash ? lienKet(chainId, dungLai.hash) : null
        },
        root_rebuild_from_logs: {
            log_block: duyetRoot.block,
            commitments_in_log: csTrenChuoi.length,
            rebuilt_root: rootDungLai,
            matches_current_root: rootDungLai === currentRoot
        }
    };

    fs.mkdirSync(THU_MUC_RA, { recursive: true });

    const tep = path.join(THU_MUC_RA, `kiem_nghiem_${tenMang}_${thoiDiem()}.json`);

    fs.writeFileSync(tep, JSON.stringify(bangChung, null, 2) + "\n", "utf8");

    // Bản CSV cho bảng của bài báo — chuyển dạng từ chính JSON trên.
    const tepCsv = ghiCsv(bangChung, tep.replace(/\.json$/, ".csv"));

    // ---------- tóm tắt ----------
    const dongTomTat = (ten: string, moi: number, cu: number) =>
        `  ${ten.padEnd(24)} ${String(moi).padStart(10)}   Ganache ${String(cu).padStart(10)}   lệch ${moi - cu >= 0 ? "+" : ""}${moi - cu}`;

    console.log(`\n=== KIỂM NGHIỆM OFF-CHAIN trên ${tenMang} (chainId ${chainId}) ===`);
    console.log(`  pool: ${diaChiPool}`);
    console.log(dongTomTat("deploy_pool", trienKhai.gas_used, gasDeployMoc));
    console.log(
        dongTomTat("update_root (500)", duyetRoot.gas_used, gasRootMoc)
        + `   sàn EIP-7623 ${calldataRoot.eip7623_floor_gas}`
    );

    for (const r of luotRut) {
        console.log(
            dongTomTat(`withdraw sv ${r.student_index}`, r.tx.gas_used, r.ganache_gas_used)
            + (r.recipient_existed_before ? "" : "   (địa chỉ nhận mới)")
        );
    }

    console.log(
        `  dùng lại nullifier       ${tieuChi.replay_rejected ? "BỊ TỪ CHỐI ✅" : "KHÔNG bị từ chối 🔴"}`
        + `   lý do: ${dungLai.revert_reason || dungLai.send_error}`
    );
    console.log(`  dựng lại cây từ log      ${tieuChi.root_rebuilt_from_chain_logs ? "KHỚP ✅" : "LỆCH 🔴"}`);
    console.log(`  tiêu chí bậc 2           ${tatCaDat ? "ĐẠT CẢ 5 ✅" : "CHƯA ĐẠT 🔴"}${tenMang === "sepolia" ? "" : "   (chạy thử — không phải mạng công khai)"}`);
    console.log(`\nĐã ghi: ${tep}`);
    console.log(`Đã ghi: ${tepCsv}`);

    if (!tatCaDat) {
        process.exit(1);
    }
}

main().catch(
    (error: any) => {
        console.error(error);
        process.exit(1);
    }
);
