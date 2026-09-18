/*
 * ============================================================
 *  KICH BAN 3 — NHIEU CHUONG TRINH CHAY SONG SONG
 *  Truc 3 · Kha nang mo rong
 * ============================================================
 *
 * CAU HOI NO TRA LOI. Truc 3 hoi hai ve:
 *   (a) chuong trinh lon hon co dat hon TREN DAU NGUOI khong?  -> da co
 *       (gas phang qua 7 muc n, bien do 48 gas tren 1 054 mau)
 *   (b) mo them chuong trinh co lam chuong trinh cu CHAM di khong?
 *       -> TRUOC DAY KHONG CO PHEP DO NAO. File nay do ve (b).
 *
 * `PoolIsolation.js` 5/5 da chung minh cac pool DOC LAP ve logic (root
 * rieng, so nullifier rieng, proof khong dung cheo duoc). Nhung doc lap
 * KHONG co nghia la khong cho nhau: neu moi pool deu ky bang CUNG MOT vi
 * thi chung chung mot chuoi nonce, va EVM buoc xu ly tuan tu.
 *
 * ------------------------------------------------------------
 * PHEP DO
 * ------------------------------------------------------------
 *
 *   block_span = max(block_number) - min(block_number) + 1
 *
 *   block_span == so giao dich  ->  moi giao dich mot block, CHO NHAU
 *   block_span <  so giao dich  ->  co giao dich CUNG block, KHONG cho nhau
 *
 * Bang chung truc tiep: giao dich cua pool A va pool B nam CUNG mot block.
 * Khong can luot doi chung — dieu do tu no da chung minh chung khong cho
 * nhau. (Doi lai: khong noi duoc "nhanh hon N lan", vi khong co moc.)
 *
 * ------------------------------------------------------------
 * 🔴 HAI DIEU KIEN BAT BUOC — thieu mot la so do VO NGHIA
 * ------------------------------------------------------------
 *
 * 1. GANACHE PHAI CHAY VOI `--miner.blockTime`.
 *    Mac dinh Ganache INSTAMINE: dao ngay mot block cho MOI giao dich.
 *    Do that 2026-08-30: 3 giao dich tu 3 vi khac nhau gui bang
 *    `Promise.all` van ra 3 block rieng => block_span = 3/3.
 *    O che do do `block_span` LUON bang so giao dich, du co song song hay
 *    khong => con so thu duoc la TAO TAC CUA GANACHE, ket luan tu no SAI.
 *    Runner nay TU KIEM va dung lai neu phat hien instamine.
 *
 * 2. MOI POOL MOT VI KY RIENG.
 *    `ShieldedPool` gan `school = msg.sender` LUC DEPLOY, rieng tung pool
 *    — hop dong DA cho phep tu dau. Truoc 2026-09-01 backend cung hoa mot
 *    vi cho moi pool, nen day la han che CAU HINH chu khong phai han che
 *    hop dong. Xem `ScholarshipPool.operatorAddress`.
 *
 * ------------------------------------------------------------
 * ⚠️ NHUNG GI PHEP DO NAY KHONG CHUNG MINH
 * ------------------------------------------------------------
 *
 * KHONG duoc viet "chay song song nen THONG LUONG tang theo so pool".
 * EVM van thuc thi tuan tu trong block va tong gas moi block van tran
 * 30 M => ~53 luot rut/block (ONC), chia bao nhieu pool cung vay.
 * Cai cai thien la DO TRE, khong phai khoi luong cong viec.
 * Tran thong luong thuoc Truc 2 — bat buoc trich cheo.
 *
 * ⚠️ `withdraw_ms` o luot nay BI THOI LEN vi phai cho nhip block
 * (blockTime). Khong so duoc voi `withdraw_ms` cua luot chinh.
 * Thu can doc la `block_number`, khong phai `withdraw_ms`.
 *
 * ------------------------------------------------------------
 * Chay:  npm run experiment:multipool-parallel
 * Ra:    experiments/results/quantitative/multipool/parallel_raw.csv
 *        experiments/results/quantitative/multipool/parallel_summary.json
 */

const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { performance } = require("perf_hooks");

const http = require("http");
http.globalAgent.keepAlive = false;

const web3 = new Web3("http://127.0.0.1:8545");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const RESULT_DIR = path.resolve(
    PROJECT_ROOT, "experiments", "results", "quantitative"
);

const MULTIPOOL_DIR = path.resolve(RESULT_DIR, "multipool");

const POOL_ARTIFACT = require(path.resolve(
    PROJECT_ROOT, "contracts", "artifacts", "contracts",
    "ShieldedPool.sol", "ShieldedPool.json"
));

const VERIFIER_ARTIFACT = require(path.resolve(
    PROJECT_ROOT, "contracts", "artifacts", "contracts",
    "Halo2Verifier.sol", "Halo2Verifier.json"
));

/*
 * Sau chuong trinh = sau kich ban da co proof san.
 *
 * Bo `n = 1`: mot pool mot sinh vien khong noi len dieu gi ve song song.
 *
 * Moi muc deu CO NGUON, khong tu dat:
 *   10 · 30 · 60 · 100  <- thang do cua Chen va cs. 2025 (IEEE CCSB)
 *   353                 <- quy mo THAT: HBKKHT cua UIT, QD 653/QD-DHCNTT
 *   500                 <- muc do trung thang voi B2 (IEEE Access 2024)
 */
const PROGRAMS = [
    { n: 10, name: "Hoc bong khuyen khich (n=10)" },
    { n: 30, name: "Hoc bong khoa CNTT (n=30)" },
    { n: 60, name: "Hoc bong vuot kho (n=60)" },
    { n: 100, name: "Hoc bong tai nang (n=100)" },
    { n: 353, name: "HBKKHT quy mo that (n=353)" },
    { n: 500, name: "Hoc bong dien rong (n=500)" }
];

const TOTAL_WITHDRAWALS = PROGRAMS.reduce((a, c) => a + c.n, 0);

/*
 * VI VAN HANH — moi pool mot vi.
 *
 * ⚠️ Ganache co 501 vi (0..500) va `n = 500` dung HET `accounts[1..500]`
 * lam nguoi nhan, nen khong con vi trong. Dung `accounts[0..5]`:
 * accounts[1..5] vua la nguoi nhan trong cac pool, vua la vi ky.
 *
 * Vo hai: nhan tien va ky giao dich la hai viec doc lap, va gas doc tu
 * `receipt.gasUsed` chu khong tu chenh lech so du. Nhung PHAI KHAI, vi
 * doc CSV thay mot dia chi vua o cot `school_account` vua la nguoi nhan
 * se tuong co loi.
 */
const OPERATOR_INDEXES = [0, 1, 2, 3, 4, 5];

const FUNDING_PER_POOL = web3.utils.toWei("2", "ether");

async function callRpc(method: string, params: any[] = []) {
    const provider: any = web3.currentProvider;

    return provider.request({
        method,
        params,
        jsonrpc: "2.0",
        id: Date.now()
    });
}

/*
 * 🔴 CHAN INSTAMINE — dung lai thay vi cho ra so vo nghia.
 *
 * Gui 3 giao dich tu 3 vi khac nhau bang `Promise.all`. Neu chung ra 3
 * block rieng thi Ganache dang instamine => phep do nay khong the chay.
 */
async function assertBlockTimeMode(accounts: string[]) {
    console.error("\n[kiem] Ganache co gop nhieu giao dich vao mot block khong...");

    const receipts = await Promise.all(
        [0, 1, 2].map((i) =>
            web3.eth.sendTransaction({
                from: accounts[i + 10],
                to: accounts[i + 20],
                value: "1"
            })
        )
    );

    const blocks = receipts.map((r: any) => Number(r.blockNumber));
    const span = Math.max(...blocks) - Math.min(...blocks) + 1;

    console.error(
        `[kiem] 3 giao dich song song -> block ${blocks.join(", ")}`
        + `  (block_span = ${span}/3)`
    );

    if (span >= 3) {
        throw new Error(
            "\n🔴 GANACHE DANG INSTAMINE — moi giao dich mot block.\n"
            + "   O che do nay `block_span` LUON bang so giao dich, du cac pool\n"
            + "   co chay song song hay khong. Con so thu duoc se la TAO TAC CUA\n"
            + "   GANACHE chu khong phai tinh chat he thong, va ket luan tu no SAI.\n\n"
            + "   Khoi dong lai Ganache voi `--miner.blockTime 2`:\n\n"
            + "   ganache --wallet.totalAccounts 501 \\\n"
            + "     --wallet.mnemonic \"test test test test test test test test test test test junk\" \\\n"
            + "     --miner.blockTime 2\n"
        );
    }

    console.error("[kiem] OK — Ganache gop duoc nhieu giao dich vao mot block.\n");
}

function docProofs(n: number) {
    const f = path.resolve(RESULT_DIR, `proofs_n${n}.json`);

    if (!fs.existsSync(f)) {
        throw new Error(
            `Thieu ${f}. Chay \`npm run experiment:proofs\` truoc.`
        );
    }

    const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.proofs;

    if (!list || list.length < n) {
        throw new Error(
            `proofs_n${n}.json chi co ${list ? list.length : 0} proof, can ${n}`
        );
    }

    return list;
}

function normalizeCalldata(p: any) {
    const raw = String(p.calldata || p.proof || "");

    return raw.startsWith("0x") ? raw : "0x" + raw;
}

/*
 * Layout calldata: [0..32) root · [32..64) nullifier · [64..96) amount.
 * `amount` PHAI lay tu public input thu ba, khong dung hang so — hop dong
 * co require("amount differs from proof").
 */
function extractPublicInputs(calldata: string) {
    const hex = calldata.replace(/^0x/, "");

    return {
        root: "0x" + hex.slice(0, 64),
        nullifier: "0x" + hex.slice(64, 128),
        amountWei: BigInt("0x" + hex.slice(128, 192)).toString()
    };
}

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

async function main() {
    fs.mkdirSync(MULTIPOOL_DIR, { recursive: true });

    const accounts = await web3.eth.getAccounts();

    if (accounts.length < 501) {
        throw new Error(
            `Ganache chi co ${accounts.length} vi, can 501.`
            + " Khoi dong lai voi --wallet.totalAccounts 501"
        );
    }

    await assertBlockTimeMode(accounts);

    // ---- 1. MOT verifier dung chung cho ca sau pool ----
    const verifier = await deployContract(
        VERIFIER_ARTIFACT, [], String(accounts[0])
    );

    console.error(
        `[deploy] verifier DUNG CHUNG: `
        + `${verifier.gasUsed.toLocaleString("en-US")} gas`
    );

    // ---- 2. Sau pool, MOI POOL MOT VI KY ----
    const pools: any[] = [];

    for (let i = 0; i < PROGRAMS.length; i++) {
        const ct = PROGRAMS[i] as any;
        const viIndex = OPERATOR_INDEXES[i] as number;
        const vi = String(accounts[viIndex]);

        const deployed = await deployContract(
            POOL_ARTIFACT,
            [verifier.address, "0"],
            vi,
            FUNDING_PER_POOL
        );

        const proofs = docProofs(ct.n).slice(0, ct.n);

        pools.push({
            ...ct,
            vi,
            viIndex,
            instance: deployed.instance,
            address: deployed.address,
            deployGas: deployed.gasUsed,
            proofs
        });

        console.error(
            `[deploy] ${ct.name}  vi=accounts[${viIndex}]`
            + `  ${deployed.gasUsed.toLocaleString("en-US")} gas`
        );
    }

    // ---- 3. Duyet root tung pool (tuan tu, khong phai phep do) ----
    for (const p of pools) {
        const root = extractPublicInputs(
            normalizeCalldata(p.proofs[0])
        ).root;

        await p.instance.methods
            .updateRoot(root, [])
            .send({ from: p.vi, gas: 3000000 });
    }

    console.error(`\n[root] da duyet root cho ${pools.length} pool\n`);

    /*
     * ---- 4. RUT SONG SONG ----
     *
     * Vong ngoai `i` chay theo CHI SO SINH VIEN. Trong moi vong, tat ca
     * pool con sinh vien deu gui giao dich CUNG LUC bang `Promise.all`.
     *
     * Moi pool ky bang VI RIENG => chuoi nonce rieng => cac giao dich nay
     * khong rang buoc thu tu voi nhau => co the vao CUNG mot block.
     *
     * Trong MOT pool van tuan tu (vong `i` cho nhau) — dung nhu luong that,
     * va giu nguyen tinh chat ma phan tich an danh dua vao.
     */
    const rows: any[] = [];
    const maxN = Math.max(...PROGRAMS.map((p) => p.n));

    const tBatDau = performance.now();

    for (let i = 0; i < maxN; i++) {
        const luot = pools.filter((p) => i < p.n);

        const ketQua = await Promise.all(
            luot.map(async (p: any) => {
                const calldata = normalizeCalldata(p.proofs[i]);
                const pub = extractPublicInputs(calldata);

                const t0 = performance.now();

                const receipt = await p.instance.methods
                    .withdraw(
                        calldata,
                        pub.root,
                        pub.nullifier,
                        // A25 — vi nhan phai la vi ghi trong proof, khong
                        // con dung vi ky cua pool lam nguoi nhan duoc nua.
                        p.proofs[i].address,
                        pub.amountWei
                    )
                    .send({ from: p.vi, gas: 3000000 });

                return {
                    pool_index: p.n,
                    program: p.name,
                    student_count: p.n,
                    student_index: i,
                    withdraw_gas: Number(receipt.gasUsed),
                    withdraw_ms: (performance.now() - t0).toFixed(2),
                    root: pub.root,
                    nullifier: pub.nullifier,
                    school_account: p.vi,
                    block_number: Number(receipt.blockNumber),
                    run_mode: "parallel"
                };
            })
        );

        rows.push(...ketQua);

        if (i % 50 === 0 || i === maxN - 1) {
            console.error(
                `[rut] vong ${i + 1}/${maxN}`
                + `  — ${rows.length}/${TOTAL_WITHDRAWALS} giao dich`
            );
        }
    }

    const tongMs = performance.now() - tBatDau;

    // ---- 5. Ghi CSV ----
    const header =
        "pool_index,program,student_count,student_index,withdraw_order,"
        + "withdraw_gas,withdraw_ms,root,nullifier,"
        + "school_account,block_number,run_mode\n";

    const csv = header + rows
        .map((r, idx) => [
            r.pool_index,
            `"${r.program}"`,
            r.student_count,
            r.student_index,
            idx + 1,
            r.withdraw_gas,
            r.withdraw_ms,
            r.root,
            r.nullifier,
            r.school_account,
            r.block_number,
            r.run_mode
        ].join(","))
        .join("\n") + "\n";

    const fCsv = path.resolve(MULTIPOOL_DIR, "parallel_raw.csv");
    fs.writeFileSync(fCsv, csv);

    // ---- 6. Doc ket qua ----
    const blocks = rows.map((r) => r.block_number);
    const blockSpan = Math.max(...blocks) - Math.min(...blocks) + 1;
    const blockRieng = new Set(blocks).size;

    // Block nao chua giao dich cua NHIEU pool khac nhau
    const theoBlock: any = {};

    rows.forEach((r) => {
        (theoBlock[r.block_number] = theoBlock[r.block_number] || new Set())
            .add(r.pool_index);
    });

    const blockDaPool = Object.entries(theoBlock)
        .filter(([, s]: any) => s.size > 1);

    const gas = rows.map((r) => r.withdraw_gas);

    const summary = {
        truc: "3 - Kha nang mo rong",
        cau_hoi:
            "Mo them chuong trinh co lam chuong trinh cu CHAM di khong?",

        so_pool: pools.length,
        tong_giao_dich: rows.length,
        tong_thoi_gian_ms: Math.round(tongMs),

        block_span: blockSpan,
        so_block_phan_biet: blockRieng,
        so_block_chua_NHIEU_pool: blockDaPool.length,
        giao_dich_moi_block_trung_binh:
            Math.round(rows.length / blockRieng * 100) / 100,

        withdraw_gas: {
            min: Math.min(...gas),
            max: Math.max(...gas),
            bien_do: Math.max(...gas) - Math.min(...gas)
        },

        ket_luan:
            blockDaPool.length > 0
                ? `${blockDaPool.length} block chua giao dich cua NHIEU pool khac nhau`
                  + " => cac chuong trinh KHONG cho nhau."
                : "KHONG block nao chua giao dich cua nhieu pool"
                  + " => chung van cho nhau. Kiem lai cau hinh Ganache.",

        cau_duoc_viet:
            `${rows.length} luot rut cua ${pools.length} chuong trinh nam trong`
            + ` ${blockRieng} block, nhieu luot cua cac chuong trinh KHAC NHAU`
            + " chung mot block => cac chuong trinh khong phai cho nhau.",

        cau_BI_CAM:
            "'Chay song song nen thong luong tang theo so pool' - SAI."
            + " EVM van thuc thi tuan tu trong block va tong gas moi block van"
            + " tran 30 M => ~53 luot rut/block, chia bao nhieu pool cung vay."
            + " Cai cai thien la DO TRE, khong phai khoi luong cong viec.",

        khai_bao: {
            vi_van_hanh:
                "Moi pool mot vi ky rieng (accounts[0..5]). accounts[1..5] vua"
                + " la nguoi nhan trong cac pool vua la vi ky - Ganache chi co"
                + " 501 vi va n=500 dung het accounts[1..500]. Vo hai vi gas doc"
                + " tu receipt.gasUsed, nhung phai khai.",

            withdraw_ms:
                "BI THOI LEN vi phai cho nhip block (--miner.blockTime)."
                + " KHONG so duoc voi withdraw_ms cua luot chinh.",

            trong_mot_pool:
                "Van TUAN TU - dung nhu luong that, va giu nguyen tinh chat ma"
                + " phan tich an danh (kenh thu tu) dua vao."
        }
    };

    fs.writeFileSync(
        path.resolve(MULTIPOOL_DIR, "parallel_summary.json"),
        JSON.stringify(summary, null, 2)
    );

    console.error("\n" + "=".repeat(64));
    console.error("KET QUA — KICH BAN 3, SONG SONG");
    console.error("=".repeat(64));
    console.error(`so pool                    : ${pools.length}`);
    console.error(`tong giao dich             : ${rows.length}`);
    console.error(`block_span                 : ${blockSpan}`);
    console.error(`so block phan biet         : ${blockRieng}`);
    console.error(`block chua NHIEU pool      : ${blockDaPool.length}`);
    console.error(`giao dich / block (TB)     : ${summary.giao_dich_moi_block_trung_binh}`);
    console.error(`withdraw_gas bien do       : ${summary.withdraw_gas.bien_do} gas`);
    console.error("");
    console.error(summary.ket_luan);
    console.error("");
    console.error(`Da ghi: ${fCsv}`);
}

main().catch((error: any) => {
    console.error(error.message || error);
    process.exit(1);
});
