/*
 * KIEM NGHIEM TREN MANG THAT (bac 2) — nhanh ON-CHAIN
 * =====================================================
 *
 * Cau hoi can tra loi: he co deploy va chay tron luong duoc tren mot mang
 * Ethereum that hay khong. Day la cau hoi CO/KHONG, nen chi can:
 *
 *   1. deploy Halo2Verifier + ShieldedPool
 *   2. duyet root voi DU 500 commitment — giao dich nang nhat, va la cho
 *      EIP-7623 co the lam doi so gas so voi Ganache
 *   3. rut cho 3 sinh vien o dau / giua / cuoi cay: 0, 250, 499, theo THIET
 *      KE TACH ma bai bao trinh bay: verifyAndRecord (hop dong tu xac thuc
 *      proof) roi settle (chi tien)
 *   4. dung lai nullifier cua sinh vien 0 — ca verifyAndRecord lan settle
 *      PHAI bi tu choi
 *   5. dung lai cay tu log CommitmentsPublished tren chuoi, so voi root
 *
 * Them mot phep do mien phi: thoi gian xac thuc proof bang eth_call toi
 * Halo2Verifier tren mang that — cung loi goi voi verify_onchain_ms tren
 * Ganache, nhung lan nay khong phai EVM viet bang JavaScript.
 *
 * Bytecode deploy chinh la artifact da do; proof lay tu `luot_bao_cao`. Tu A25
 * (12/09/2026) public input gom [root, nullifier, amount, recipient] — van
 * khong co dia chi hop dong, nen proof do tren Ganache dung lai duoc tren
 * Sepolia. Proof do TRUOC A25 (3 public input) bi chot ben duoi tu choi:
 * phai do lai dinh luong truoc khi kiem nghiem.
 *
 * Gas la tat dinh, nen so gas tren mang that PHAI trung dong tuong ung trong
 * gas_onchain_n500.csv, tru hai ngoai le biet truoc:
 *   - updateRoot: san phi calldata cua EIP-7623 (Prague). Ganache dung o
 *     Shanghai nen khong co san nay.
 *   - settle: +25 000 gas neu dia chi nhan CHUA TUNG TON TAI tren mang do
 *     (phi tao tai khoan). Tren Ganache moi vi deu co san.
 * Script ghi du du lieu de giai thich tung chenh lech, khong tu y sua so.
 *
 * Gas limit duoc UOC LUONG, khong co dinh: san EIP-7623 cua updateRoot
 * n = 500 cao hon muc runner dinh luong tung dat. Gas limit khong anh huong
 * gasUsed.
 *
 * Bien moi truong (backend/.env — da bi git chan):
 *   KIEM_NGHIEM_RPC_URL      mac dinh http://127.0.0.1:8545 (chay thu Ganache)
 *   KIEM_NGHIEM_PRIVATE_KEY  bat buoc tren mang that; tren may cuc bo bo trong
 *                            thi dung accounts[0] cua GANACHE_MNEMONIC
 *   KIEM_NGHIEM_PROOFS       tro toi tep proof khac `luot_bao_cao` (duong dan
 *                            tinh tu goc repo). Dung khi luot bao cao van la
 *                            proof TRUOC A25 (3 public input).
 *
 * Chay:  npm run experiment:sepolia
 * Ghi:   experiments/results/sepolia/kiem_nghiem_<mang>_<thoi-diem>.json
 */

// spawnSync len prover chan event loop — xem benchmarkGas.ts.
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "..", "..", ".env")
});

const { ethers } = require("ethers");

const {
    runProver
} = require("../clients/prover/halo2ProverClient");

const {
    normalizeCalldata,
    extractPublicInputs
} = require("../clients/blockchain/shieldedPoolClient");

const {
    ghiCsv
} = require("./sepoliaCsv");

// =========================
// CAU HINH
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

// Giong VERIFIER_CALL_GAS trong shieldedPoolClient.ts — cung loi goi da do.
const VERIFIER_CALL_GAS = 3_000_000n;

/*
 * Chi cho chay tren may cuc bo va Sepolia. Mainnet va moi mang khac bi chan:
 * script nay tieu ETH va deploy hop dong cong khai.
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
 * Nguon proof. Mac dinh la luot bao cao — cung lo do sinh ra gas_onchain_n500.csv,
 * nen so gas doi chieu duoc truc tiep. KIEM_NGHIEM_PROOFS tro toi tep khac khi
 * luot bao cao con la proof TRUOC A25; luc do moc trong CSV thuoc mot ban mach
 * khac, va script tu ghi ro dieu do (xem baseline_note).
 */
const TEP_PROOF =
    process.env.KIEM_NGHIEM_PROOFS
        ? path.resolve(PROJECT_ROOT, process.env.KIEM_NGHIEM_PROOFS)
        : path.join(THU_MUC_DO, `proofs_n${N}.json`);

const PROOF_CUNG_LUOT_DO = !process.env.KIEM_NGHIEM_PROOFS;

const POOL_ARTIFACT =
    require(
        path.join(PROJECT_ROOT, "contracts", "artifacts", "contracts", "ShieldedPool.sol", "ShieldedPool.json")
    );

const VERIFIER_ARTIFACT =
    require(
        path.join(PROJECT_ROOT, "contracts", "artifacts", "contracts", "Halo2Verifier.sol", "Halo2Verifier.json")
    );

/*
 * Gas du tru de kiem so du TRUOC khi tieu: deploy verifier + pool,
 * updateRoot o muc san EIP-7623, 3 x (verifyAndRecord + settle), 2 giao dich
 * dung lai nullifier, cong bien 30 %.
 */
const GAS_DU_TRU =
    BigInt(Math.ceil((4_371_791 + 1_884_412 + 700_000 + 3 * (595_200 + 69_625) + 2 * 100_000) * 1.3));

// =========================
// TIEN ICH
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
 * EIP-7623 (Prague): gas cua giao dich >= 21 000 + 10 x token, voi
 * token = so byte 0 + 4 x so byte khac 0 trong calldata.
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
 * Dia chi da "ton tai" theo nghia cua EVM thi chuyen tien toi khong mat phi
 * tao tai khoan. Ghi lai de giai thich chenh lech +25 000 gas o settle.
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
 * Giao dich PHAI revert: truoc het staticCall de lay ly do, roi gui that
 * voi gasLimit co dinh (uoc luong se that bai vi revert) de co mot giao dich
 * that bai NAM TREN CHUOI — ai co hash cung tu tra duoc.
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
        // Co node tu choi ngay o buoc gui — van la bi tu choi, ghi lai ly do.
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
    // ---------- 1. du lieu da do — tinh cuc bo, KHONG ton ETH ----------
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
        docCsv(path.join(THU_MUC_DO, `gas_onchain_n${N}.csv`));

    const sinhVien: any[] = dataset.students;

    console.error(`Tinh ${sinhVien.length} commitment tu dataset ...`);

    // Giong loadCommitments() cua benchmarkGas.ts (K19).
    const commitments: string[] =
        sinhVien.map((sv: any) =>
            String(runProver("commitment", sv.note).commitment)
        );

    console.error("Tinh root tu 500 commitment (mat khoang 30 giay) ...");

    const rootTinh = String(runProver("root", { commitments }).root).toLowerCase();
    const rootProof = String(proofs[0]?.root).toLowerCase();

    if (rootTinh !== rootProof) {
        throw new Error(
            `root tinh lai ${rootTinh} khac root cua proof ${rootProof} — dung truoc khi tieu ETH`
        );
    }

    for (const i of CHI_SO) {
        const p = proofs.find((x: any) => x.student_index === i);

        if (!p) {
            throw new Error(`khong co proof cho student_index ${i}`);
        }

        if (String(p.root).toLowerCase() !== rootProof) {
            throw new Error(`proof ${i} khong cung root voi pool`);
        }

        // A25 — word thu 4 cua calldata phai la vi cua sinh vien do.
        const vao = extractPublicInputs(normalizeCalldata(p));
        if (BigInt(vao.recipient) !== BigInt(p.address)) {
            throw new Error(
                `proof ${i} khong mang vi nhan ${p.address} — la proof do TRUOC A25;`
                + " chay lai dinh luong (experiment:proofs + experiment:gas) truoc khi kiem nghiem"
            );
        }
    }

    // ---------- 2. ket noi, chan mang la, kiem so du ----------
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = String((await provider.getNetwork()).chainId);
    const tenMang = TEN_MANG[chainId];

    if (!tenMang) {
        throw new Error(`chainId ${chainId} khong nam trong danh sach cho phep (ganache / hardhat / sepolia)`);
    }

    const cucBo = laMayCucBo(RPC_URL);
    const viMacDinh = ethers.Wallet.fromPhrase(GANACHE_MNEMONIC);

    let vi: any;

    if (PRIVATE_KEY) {
        vi = new ethers.Wallet(PRIVATE_KEY, provider);
    } else if (cucBo) {
        vi = viMacDinh.connect(provider);
    } else {
        throw new Error("mang that can KIEM_NGHIEM_PRIVATE_KEY trong backend/.env");
    }

    if (!cucBo && vi.address.toLowerCase() === viMacDinh.address.toLowerCase()) {
        throw new Error("khong dung vi cua mnemonic cong khai 'test ... junk' tren mang that");
    }

    const tongTien: bigint =
        sinhVien.reduce((s: bigint, sv: any) => s + BigInt(sv.note.amount), 0n);

    // Giong runner dinh luong: von = tong + tong / n.
    const vonPool = tongTien + tongTien / BigInt(N);

    const phi = await provider.getFeeData();
    const giaGas: bigint = phi.maxFeePerGas ?? phi.gasPrice ?? 0n;
    const soDu: bigint = await provider.getBalance(vi.address);
    const canCo = giaGas * GAS_DU_TRU + vonPool;

    console.error(
        `Mang ${tenMang} (chainId ${chainId}) | vi ${vi.address}`
        + ` | so du ${ethers.formatEther(soDu)} ETH | du tru ${ethers.formatEther(canCo)} ETH`
    );

    if (soDu < canCo) {
        throw new Error(`so du khong du: can khoang ${ethers.formatEther(canCo)} ETH`);
    }

    // ---------- 3. deploy ----------
    console.error("Deploy Halo2Verifier ...");

    const factoryVerifier =
        new ethers.ContractFactory(VERIFIER_ARTIFACT.abi, VERIFIER_ARTIFACT.bytecode, vi);

    const verifier: any = await factoryVerifier.deploy();
    const trienKhaiVerifier = await choBienNhan(verifier.deploymentTransaction());
    const diaChiVerifier = String(await verifier.getAddress());

    console.error("Deploy ShieldedPool ...");

    const factoryPool =
        new ethers.ContractFactory(POOL_ARTIFACT.abi, POOL_ARTIFACT.bytecode, vi);

    // V1(b): poolDenomination = 0 — giong runner dinh luong.
    const pool: any = await factoryPool.deploy(diaChiVerifier, "0", { value: vonPool });
    const trienKhaiPool = await choBienNhan(pool.deploymentTransaction());
    const diaChiPool = String(await pool.getAddress());

    // ---------- 4. duyet root voi du 500 commitment ----------
    console.error(`Duyet root voi ${commitments.length} commitment ...`);

    const txRoot = await pool.updateRoot(rootProof, commitments);
    const duyetRoot = await choBienNhan(txRoot);
    const calldataRoot = phanTichCalldata(String(txRoot.data));

    const currentRoot = String(await pool.currentRoot()).toLowerCase();
    const rootHopLe = Boolean(await pool.validRoot(rootProof));

    // ---------- 5. rut cho 3 sinh vien — thiet ke tach ----------
    const luotRut: any[] = [];

    for (const i of CHI_SO) {
        const p = proofs.find((x: any) => x.student_index === i);

        const proofAndSignals = normalizeCalldata(p);

        const {
            root,
            nullifier,
            amountWei
        } = extractPublicInputs(proofAndSignals);

        const nguoiNhan = await trangThaiDiaChi(provider, p.address);

        // Xac thuc thuan bang eth_call — mien phi, cung loi goi voi
        // verify_onchain_ms tren Ganache.
        const t0 = performance.now();

        await provider.call({
            to: diaChiVerifier,
            data: proofAndSignals,
            gasLimit: VERIFIER_CALL_GAS
        });

        const xacThucMs = performance.now() - t0;

        console.error(`verifyAndRecord cho sinh vien ${i} ...`);

        const txGhi = await pool.verifyAndRecord(proofAndSignals, root, nullifier, p.address, amountWei);
        const ghi = await choBienNhan(txGhi);

        console.error(`settle cho sinh vien ${i} ...`);

        const txChi = await pool.settle(nullifier);
        const chi = await choBienNhan(txChi);

        const dongMoc = moc.find((r: any) => Number(r.student_index) === i);
        const mocGhi = dongMoc ? Number(dongMoc.verify_record_gas) : null;
        const mocChi = dongMoc ? Number(dongMoc.settle_gas) : null;
        const mocMs = dongMoc ? Number(dongMoc.verify_onchain_ms) : null;

        luotRut.push({
            student_index: i,
            recipient: p.address,
            recipient_existed_before: nguoiNhan.existed,
            verify_by_call_ms: Number(xacThucMs.toFixed(2)),
            ganache_verify_onchain_ms: mocMs,
            verify_and_record: {
                ...ghi,
                explorer: lienKet(chainId, ghi.hash),
                ganache_gas_used: mocGhi,
                delta_vs_ganache: mocGhi === null ? null : ghi.gas_used - mocGhi
            },
            settle: {
                ...chi,
                explorer: lienKet(chainId, chi.hash),
                ganache_gas_used: mocChi,
                delta_vs_ganache: mocChi === null ? null : chi.gas_used - mocChi
            },
            split_total_gas: ghi.gas_used + chi.gas_used,
            nullifier_marked_used: Boolean(await pool.usedNullifier(nullifier))
        });
    }

    // ---------- 6. dung lai nullifier — ca hai buoc phai bi tu choi ----------
    console.error("Dung lai nullifier cua sinh vien 0 ...");

    const p0 = proofs.find((x: any) => x.student_index === CHI_SO[0]);
    const calldata0 = normalizeCalldata(p0);
    const vao0 = extractPublicInputs(calldata0);

    const ghiLai =
        await guiPhaiRevert(
            pool.verifyAndRecord,
            [calldata0, vao0.root, vao0.nullifier, p0.address, vao0.amountWei],
            300_000n,
            provider
        );

    const chiLai =
        await guiPhaiRevert(
            pool.settle,
            [vao0.nullifier],
            200_000n,
            provider
        );

    // ---------- 7. ben thu ba dung lai cay tu log tren chuoi ----------
    console.error("Dung lai cay tu log CommitmentsPublished (mat khoang 30 giay) ...");

    const suKien = pool.interface.getEvent("CommitmentsPublished");

    const logs =
        await provider.getLogs({
            address: diaChiPool,
            topics: [suKien.topicHash],
            fromBlock: duyetRoot.block,
            toBlock: duyetRoot.block
        });

    if (logs.length === 0) {
        throw new Error("khong tim thay log CommitmentsPublished tren chuoi");
    }

    const giaiMa = pool.interface.parseLog(logs[0]);
    const csTrenChuoi: string[] = Array.from(giaiMa.args.commitments).map((x: any) => String(x));
    const rootDungLai = String(runProver("root", { commitments: csTrenChuoi }).root).toLowerCase();

    // ---------- 8. ket luan + ghi bang chung ----------
    const gasVerifierMoc = Number(moc[0]?.deploy_verifier_gas);
    const gasPoolMoc = Number(moc[0]?.deploy_pool_gas);
    const gasRootMoc = Number(moc[0]?.update_root_gas);

    const biTuChoi = (k: any) => k.static_call_reverted && (k.status === 0 || k.send_error !== null);

    const tieuChi = {
        deployed: trienKhaiVerifier.status === 1 && trienKhaiPool.status === 1,
        root_approved: duyetRoot.status === 1 && currentRoot === rootProof && rootHopLe,
        all_withdrawals_succeeded: luotRut.every(
            (r: any) => r.verify_and_record.status === 1 && r.settle.status === 1 && r.nullifier_marked_used
        ),
        replay_rejected: biTuChoi(ghiLai) && biTuChoi(chiLai),
        root_rebuilt_from_chain_logs: rootDungLai === currentRoot && csTrenChuoi.length === N
    };

    const tatCaDat = Object.values(tieuChi).every(Boolean);

    const bangChung = {
        metadata: {
            mechanism: "onchain",
            measured_at_local: thoiDiem(),
            network: tenMang,
            chain_id: chainId,
            // Chi ghi host: URL cua Infura/Alchemy chua API key.
            rpc_host: new URL(RPC_URL).host,
            school_address: vi.address,
            n_pool: N,
            students_withdrawn: CHI_SO,
            withdrawal_design: "split — verifyAndRecord + settle",
            reference_run: "experiments/results/quantitative/luot_bao_cao (09/09/2026, Ganache, Shanghai)",
            proof_source: path.relative(PROJECT_ROOT, TEP_PROOF).replace(/\\/g, "/"),
            baseline_same_circuit: PROOF_CUNG_LUOT_DO,
            baseline_note: PROOF_CUNG_LUOT_DO
                ? "proof va gas CSV cung mot lo do — moi delta_vs_ganache deu la so so sanh that"
                : "gas_onchain_n500.csv la cua lo do 09/09 (TRUOC A25). Mach da doi, nen"
                    + " delta_vs_ganache o deploy_verifier va verify_record KHONG phai sai so"
                    + " cua mang — doi chieu dung la lan chay cung script nay tren Ganache."
        },
        level2_criteria: tieuChi,
        level2_reached: tatCaDat && tenMang === "sepolia",
        contracts: {
            halo2_verifier: diaChiVerifier,
            shielded_pool: diaChiPool,
            explorer_verifier: EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${diaChiVerifier}` : null,
            explorer_pool: EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${diaChiPool}` : null
        },
        deploy_verifier: {
            ...trienKhaiVerifier,
            explorer: lienKet(chainId, trienKhaiVerifier.hash),
            ganache_gas_used: gasVerifierMoc,
            delta_vs_ganache: trienKhaiVerifier.gas_used - gasVerifierMoc
        },
        deploy_pool: {
            ...trienKhaiPool,
            explorer: lienKet(chainId, trienKhaiPool.hash),
            ganache_gas_used: gasPoolMoc,
            delta_vs_ganache: trienKhaiPool.gas_used - gasPoolMoc
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
            verify_and_record_again: {
                ...ghiLai,
                explorer: ghiLai.hash ? lienKet(chainId, ghiLai.hash) : null
            },
            settle_again: {
                ...chiLai,
                explorer: chiLai.hash ? lienKet(chainId, chiLai.hash) : null
            }
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

    // Ban CSV cho bang cua bai bao — chuyen dang tu chinh JSON tren.
    const tepCsv = ghiCsv(bangChung, tep.replace(/\.json$/, ".csv"));

    // ---------- tom tat ----------
    const dongTomTat = (ten: string, moi: number, cu: number) =>
        `  ${ten.padEnd(24)} ${String(moi).padStart(10)}   Ganache ${String(cu).padStart(10)}   lech ${moi - cu >= 0 ? "+" : ""}${moi - cu}`;

    console.log(`\n=== KIEM NGHIEM ON-CHAIN tren ${tenMang} (chainId ${chainId}) ===`);
    console.log(`  verifier: ${diaChiVerifier}`);
    console.log(`  pool    : ${diaChiPool}`);
    console.log(dongTomTat("deploy_verifier", trienKhaiVerifier.gas_used, gasVerifierMoc));
    console.log(dongTomTat("deploy_pool", trienKhaiPool.gas_used, gasPoolMoc));
    console.log(
        dongTomTat("update_root (500)", duyetRoot.gas_used, gasRootMoc)
        + `   san EIP-7623 ${calldataRoot.eip7623_floor_gas}`
    );

    for (const r of luotRut) {
        console.log(dongTomTat(`verify_record sv ${r.student_index}`, r.verify_and_record.gas_used, r.verify_and_record.ganache_gas_used));
        console.log(
            dongTomTat(`settle sv ${r.student_index}`, r.settle.gas_used, r.settle.ganache_gas_used)
            + (r.recipient_existed_before ? "" : "   (dia chi nhan moi)")
        );
        console.log(`  verify eth_call sv ${String(r.student_index).padEnd(6)} ${String(r.verify_by_call_ms).padStart(10)} ms   Ganache ${r.ganache_verify_onchain_ms} ms`);
    }

    console.log(
        `  dung lai nullifier       ${tieuChi.replay_rejected ? "BI TU CHOI ✅" : "KHONG bi tu choi 🔴"}`
        + `   (${ghiLai.revert_reason || ghiLai.send_error} | ${chiLai.revert_reason || chiLai.send_error})`
    );
    console.log(`  dung lai cay tu log      ${tieuChi.root_rebuilt_from_chain_logs ? "KHOP ✅" : "LECH 🔴"}`);
    console.log(`  tieu chi bac 2           ${tatCaDat ? "DAT CA 5 ✅" : "CHUA DAT 🔴"}${tenMang === "sepolia" ? "" : "   (chay thu — khong phai mang cong khai)"}`);
    console.log(`\nDa ghi: ${tep}`);
    console.log(`Da ghi: ${tepCsv}`);

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
