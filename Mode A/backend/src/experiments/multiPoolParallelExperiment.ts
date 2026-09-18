/*
 * ============================================================
 *  KICH BAN 3 — NHIEU CHUONG TRINH CHAY SONG SONG  (nhanh OFF-CHAIN)
 *  Truc 3 · Kha nang mo rong
 * ============================================================
 *
 * Doi xung voi `zk-halo2-onchain`. BA KHAC BIET cua nhanh nay:
 *   1. KHONG co Halo2Verifier — proof duoc xac minh OFF-CHAIN o backend.
 *   2. `constructor(uint256 poolDenomination)` — mot tham so, khong co
 *      dia chi verifier.
 *   3. `withdrawOffChain(root, nullifier, recipient, amount)` — KHONG
 *      nhan proof calldata. Hop dong TIN backend da xac minh.
 *      => Day chinh la ly do ADV re hon, va PHAI khai kem moi con so.
 *
 * ------------------------------------------------------------
 * CAU HOI NO TRA LOI
 * ------------------------------------------------------------
 * Truc 3 hoi hai ve:
 *   (a) chuong trinh lon hon co dat hon TREN DAU NGUOI khong?  -> da co
 *   (b) mo them chuong trinh co lam chuong trinh cu CHAM di khong?
 *       -> file nay do ve (b)
 *
 * ------------------------------------------------------------
 * 🔴 CHI SO CHINH — KHONG phai `block_span`
 * ------------------------------------------------------------
 * Duoi `--miner.blockTime`, Ganache dao block THEO DONG HO, nen
 * `block_span = max - min + 1` lon chi vi THOI GIAN TROI, bat ke co song
 * song hay khong. Do that o nhanh ONC: block_span = 500 = dung so vong
 * lap — no noi ve THOI LUONG, khong noi ve DONG THOI.
 *
 *   CHI SO DUNG = so block chua giao dich cua NHIEU pool KHAC NHAU.
 *
 * ------------------------------------------------------------
 * 🔴 HAI DIEU KIEN BAT BUOC
 * ------------------------------------------------------------
 * 1. Ganache PHAI chay voi `--miner.blockTime 2`. Mac dinh la instamine
 *    (mot block moi giao dich) => chi so vo nghia. Runner TU KIEM va dung.
 * 2. Moi pool MOT VI KY rieng. `ShieldedPool` gan `school = msg.sender`
 *    luc deploy, rieng tung pool — hop dong da cho phep tu dau.
 *
 * ⚠️ KHONG duoc viet "song song nen THONG LUONG tang theo so pool".
 * EVM van tuan tu trong block, tong gas moi block van tran 30 M.
 * Cai cai thien la DO TRE. Tran thong luong thuoc Truc 2.
 *
 * ⚠️ `withdraw_ms` o luot nay BI THOI LEN vi cho nhip block — khong so
 * duoc voi luot chinh.
 *
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

/*
 * Sau chuong trinh = sau kich ban da co proof san. Bo `n = 1`.
 * Moi muc deu CO NGUON:
 *   10 · 30 · 60 · 100  <- thang do Chen va cs. 2025 (IEEE CCSB)
 *   353                 <- quy mo THAT: HBKKHT UIT, QD 653/QD-DHCNTT
 *   500                 <- muc trung thang voi B2 (IEEE Access 2024)
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
 * ⚠️ Ganache co 501 vi (0..500) va `n = 500` dung HET `accounts[1..500]`
 * lam nguoi nhan, nen khong con vi trong. Dung `accounts[0..5]`:
 * accounts[1..5] vua la nguoi nhan vua la vi ky. Vo hai (gas doc tu
 * `receipt.gasUsed`, khong tu chenh lech so du) nhung PHAI KHAI.
 */
const OPERATOR_INDEXES = [0, 1, 2, 3, 4, 5];

const FUNDING_PER_POOL = web3.utils.toWei("2", "ether");

/*
 * 🔴 CHAN INSTAMINE — dung lai thay vi cho ra so vo nghia.
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
            + "   O che do nay so block LUON bang so giao dich, du cac pool co\n"
            + "   chay song song hay khong => con so la TAO TAC CUA GANACHE,\n"
            + "   khong phai tinh chat he thong, va ket luan tu no SAI.\n\n"
            + "   Khoi dong lai Ganache voi `--miner.blockTime 2`:\n\n"
            + "   ganache --wallet.totalAccounts 501 \\\n"
            + "     --wallet.mnemonic \"test test test test test test test test test test test junk\" \\\n"
            + "     --miner.blockTime 2\n"
        );
    }

    console.error("[kiem] OK — Ganache gop duoc nhieu giao dich vao mot block.\n");
}

function docProofs(n: number) {
    const f = path.resolve(RESULT_DIR, `proofs_offchain_n${n}.json`);

    if (!fs.existsSync(f)) {
        throw new Error(
            `Thieu ${f}. Chay \`npm run experiment:quantitative\` truoc.`
        );
    }

    const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.proofs;

    if (!list || list.length < n) {
        throw new Error(
            `proofs_offchain_n${n}.json chi co ${list ? list.length : 0} proof, can ${n}`
        );
    }

    return list;
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

    /*
     * ---- 1. Sau pool, MOI POOL MOT VI KY ----
     * KHONG co verifier: nhanh nay xac minh off-chain.
     * `constructor(uint256 poolDenomination)` — "0" = khong cuong che.
     */
    const pools: any[] = [];

    for (let i = 0; i < PROGRAMS.length; i++) {
        const ct = PROGRAMS[i] as any;
        const viIndex = OPERATOR_INDEXES[i] as number;
        const vi = String(accounts[viIndex]);

        const deployed = await deployContract(
            POOL_ARTIFACT,
            ["0"],
            vi,
            FUNDING_PER_POOL
        );

        pools.push({
            ...ct,
            vi,
            viIndex,
            instance: deployed.instance,
            address: deployed.address,
            deployGas: deployed.gasUsed,
            proofs: docProofs(ct.n).slice(0, ct.n)
        });

        console.error(
            `[deploy] ${ct.name}  vi=accounts[${viIndex}]`
            + `  ${deployed.gasUsed.toLocaleString("en-US")} gas`
        );
    }

    // ---- 2. Duyet root tung pool (tuan tu, khong phai phep do) ----
    for (const p of pools) {
        await p.instance.methods
            .updateRoot(p.proofs[0].root, [])
            .send({ from: p.vi, gas: 3000000 });
    }

    console.error(`\n[root] da duyet root cho ${pools.length} pool\n`);

    /*
     * ---- 3. RUT SONG SONG ----
     *
     * Vong ngoai chay theo CHI SO SINH VIEN. Trong moi vong, tat ca pool
     * con sinh vien gui giao dich CUNG LUC bang `Promise.all`.
     *
     * Moi pool ky bang VI RIENG => chuoi nonce rieng => khong rang buoc
     * thu tu voi nhau => co the vao CUNG mot block.
     *
     * Trong MOT pool van tuan tu — dung nhu luong that, va giu nguyen
     * tinh chat ma phan tich an danh dua vao.
     */
    const rows: any[] = [];
    const maxN = Math.max(...PROGRAMS.map((p) => p.n));

    const tBatDau = performance.now();

    for (let i = 0; i < maxN; i++) {
        const luot = pools.filter((p) => i < p.n);

        const ketQua = await Promise.all(
            luot.map(async (p: any) => {
                const pr = p.proofs[i];
                const t0 = performance.now();

                const receipt = await p.instance.methods
                    .withdrawOffChain(
                        pr.root,
                        pr.nullifier,
                        p.vi,
                        String(pr.amountWei)
                    )
                    .send({ from: p.vi, gas: 3000000 });

                return {
                    pool_index: p.n,
                    program: p.name,
                    student_count: p.n,
                    student_index: i,
                    withdraw_gas: Number(receipt.gasUsed),
                    withdraw_ms: (performance.now() - t0).toFixed(2),
                    root: pr.root,
                    nullifier: pr.nullifier,
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

    // ---- 4. Ghi CSV ----
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

    // ---- 5. Doc ket qua ----
    const blocks = rows.map((r) => r.block_number);
    const blockSpan = Math.max(...blocks) - Math.min(...blocks) + 1;
    const blockRieng = new Set(blocks).size;

    const theoBlock: any = {};

    rows.forEach((r) => {
        (theoBlock[r.block_number] = theoBlock[r.block_number] || new Set())
            .add(r.pool_index);
    });

    const blockDaPool = Object.entries(theoBlock)
        .filter(([, s]: any) => s.size > 1);

    const phanBo: any = {};

    Object.values(theoBlock).forEach((s: any) => {
        phanBo[s.size] = (phanBo[s.size] || 0) + 1;
    });

    const gas = rows.map((r) => r.withdraw_gas);

    const summary = {
        mechanism: "offchain",
        truc: "3 - Kha nang mo rong",
        cau_hoi:
            "Mo them chuong trinh co lam chuong trinh cu CHAM di khong?",

        so_pool: pools.length,
        tong_giao_dich: rows.length,
        tong_thoi_gian_ms: Math.round(tongMs),

        so_block_chua_NHIEU_pool: blockDaPool.length,
        phan_bo_so_pool_cung_block: phanBo,
        so_block_phan_biet: blockRieng,
        giao_dich_moi_block_trung_binh:
            Math.round(rows.length / blockRieng * 100) / 100,

        block_span_KHONG_dung_lam_ket_luan: blockSpan,

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

        cau_BI_CAM: [
            "'Song song nen thong luong tang theo so pool' - SAI. EVM van thuc"
            + " thi tuan tu trong block va tong gas moi block van tran 30 M."
            + " Cai cai thien la DO TRE. Tran thong luong thuoc Truc 2.",

            "Dung `block_span` lam ket luan - SAI. Duoi --miner.blockTime,"
            + " Ganache dao block THEO DONG HO nen block_span lon chi vi thoi"
            + " gian troi. Chi so dung la `so_block_chua_NHIEU_pool`.",

            "So `withdraw_ms` cua luot nay voi luot chinh - SAI, no bi thoi"
            + " len vi cho nhip block."
        ],

        khai_bao: {
            co_che_xac_minh:
                "Nhanh nay xac minh proof OFF-CHAIN o backend."
                + " `withdrawOffChain` KHONG nhan proof calldata - hop dong TIN"
                + " backend da xac minh. Day la ly do ADV re hon ONC, PHAI khai"
                + " kem moi con so gas.",

            vi_van_hanh:
                "Moi pool mot vi ky rieng (accounts[0..5]). accounts[1..5] vua"
                + " la nguoi nhan vua la vi ky - Ganache chi co 501 vi ma n=500"
                + " dung het accounts[1..500]. Vo hai vi gas doc tu"
                + " receipt.gasUsed, nhung phai khai.",

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
    console.error("KET QUA — KICH BAN 3, SONG SONG  (OFF-CHAIN)");
    console.error("=".repeat(64));
    console.error(`so pool                    : ${pools.length}`);
    console.error(`tong giao dich             : ${rows.length}`);
    console.error(`block chua NHIEU pool      : ${blockDaPool.length}   <- CHI SO CHINH`);
    console.error(`so block phan biet         : ${blockRieng}`);
    console.error(`giao dich / block (TB)     : ${summary.giao_dich_moi_block_trung_binh}`);
    console.error(`withdraw_gas bien do       : ${summary.withdraw_gas.bien_do} gas`);
    console.error("");
    console.error("phan bo so pool cung block :");

    Object.keys(phanBo)
        .sort((a, b) => Number(b) - Number(a))
        .forEach((k) => {
            console.error(`  ${k} pool cung block : ${phanBo[k]} block`);
        });

    console.error("");
    console.error(summary.ket_luan);
    console.error("");
    console.error(`Da ghi: ${fCsv}`);
}

main().catch((error: any) => {
    console.error(error.message || error);
    process.exit(1);
});
