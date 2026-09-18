/*
 * Xuat bang chung kiem nghiem Sepolia (JSON) ra CSV — nhanh ON-CHAIN.
 *
 * Vi sao co file nay: tep JSON la ban day du, nhung bai bao can mot bang
 * doc duoc thang. CSV nay la BAN CHUYEN DANG, khong phai phep do moi —
 * moi con so deu lay nguyen tu JSON, khong tinh lai gi ca.
 *
 * Dung hai kieu:
 *   - sepoliaValidation.ts goi ghiCsv(bangChung, tep) ngay sau khi ghi JSON
 *   - chay tay tren mot tep JSON da co:
 *       node -r ts-node/register src/experiments/sepoliaCsv.ts <duong dan .json>
 *
 * Cot:
 *   loai      trien_khai | duyet_root | rut | dung_lai | tieu_chi | tong_hop
 *   buoc      ten buoc / ten tieu chi
 *   gas_used  gas THAT tren mang; ganache_gas_used la moc de doi chieu
 */

const fs = require("fs");
const path = require("path");

const COT = [
    "loai",
    "mechanism",
    "network",
    "chain_id",
    "buoc",
    "student_index",
    "gas_used",
    "ganache_gas_used",
    "delta_vs_ganache",
    "thoi_gian_ms",
    "block",
    "status",
    "tx_hash",
    "ghi_chu"
];

function o(giaTri: any): string {
    if (giaTri === null || giaTri === undefined) {
        return "";
    }

    const s = String(giaTri).replace(/"/g, "'");

    return /[,"\n]/.test(s) ? `"${s}"` : s;
}

function dong(r: any): string {
    return COT.map((c) => o(r[c])).join(",");
}

function ghiCsv(bangChung: any, tep: string): string {
    const m = bangChung.metadata;

    const chung = {
        mechanism: m.mechanism,
        network: m.network,
        chain_id: m.chain_id
    };

    const hang: any[] = [];

    hang.push({
        ...chung,
        loai: "trien_khai",
        buoc: "deploy_verifier",
        gas_used: bangChung.deploy_verifier.gas_used,
        ganache_gas_used: bangChung.deploy_verifier.ganache_gas_used,
        delta_vs_ganache: bangChung.deploy_verifier.delta_vs_ganache,
        block: bangChung.deploy_verifier.block,
        status: bangChung.deploy_verifier.status,
        tx_hash: bangChung.deploy_verifier.hash,
        ghi_chu: `Halo2Verifier ${bangChung.contracts.halo2_verifier}`
    });

    hang.push({
        ...chung,
        loai: "trien_khai",
        buoc: "deploy_pool",
        gas_used: bangChung.deploy_pool.gas_used,
        ganache_gas_used: bangChung.deploy_pool.ganache_gas_used,
        delta_vs_ganache: bangChung.deploy_pool.delta_vs_ganache,
        block: bangChung.deploy_pool.block,
        status: bangChung.deploy_pool.status,
        tx_hash: bangChung.deploy_pool.hash,
        ghi_chu: `ShieldedPool ${bangChung.contracts.shielded_pool}`
    });

    const u = bangChung.update_root;

    hang.push({
        ...chung,
        loai: "duyet_root",
        buoc: "updateRoot",
        gas_used: u.gas_used,
        ganache_gas_used: u.ganache_gas_used,
        delta_vs_ganache: u.delta_vs_ganache,
        block: u.block,
        status: u.status,
        tx_hash: u.hash,
        ghi_chu:
            `${u.commitments} commitment; calldata ${u.calldata.calldata_bytes} B;`
            + ` san EIP-7623 ${u.calldata.eip7623_floor_gas};`
            + ` gas bang san: ${u.gas_equals_eip7623_floor}`
    });

    for (const r of bangChung.withdrawals) {
        hang.push({
            ...chung,
            loai: "rut",
            buoc: "verifyAndRecord",
            student_index: r.student_index,
            gas_used: r.verify_and_record.gas_used,
            ganache_gas_used: r.verify_and_record.ganache_gas_used,
            delta_vs_ganache: r.verify_and_record.delta_vs_ganache,
            thoi_gian_ms: r.verify_by_call_ms,
            block: r.verify_and_record.block,
            status: r.verify_and_record.status,
            tx_hash: r.verify_and_record.hash,
            ghi_chu:
                `vi nhan ${r.recipient}; vi da ton tai: ${r.recipient_existed_before};`
                + ` thoi_gian_ms la eth_call toi verifier (Ganache ${r.ganache_verify_onchain_ms} ms)`
        });

        hang.push({
            ...chung,
            loai: "rut",
            buoc: "settle",
            student_index: r.student_index,
            gas_used: r.settle.gas_used,
            ganache_gas_used: r.settle.ganache_gas_used,
            delta_vs_ganache: r.settle.delta_vs_ganache,
            block: r.settle.block,
            status: r.settle.status,
            tx_hash: r.settle.hash,
            ghi_chu: `nullifier danh dau da dung: ${r.nullifier_marked_used}`
        });
    }

    const dl = bangChung.nullifier_replay;

    hang.push({
        ...chung,
        loai: "dung_lai",
        buoc: "verifyAndRecord_lai",
        student_index: dl.student_index,
        gas_used: dl.verify_and_record_again.gas_used,
        block: dl.verify_and_record_again.block,
        status: dl.verify_and_record_again.status,
        tx_hash: dl.verify_and_record_again.hash,
        ghi_chu: `PHAI bi tu choi: ${dl.verify_and_record_again.revert_reason || dl.verify_and_record_again.send_error}`
    });

    hang.push({
        ...chung,
        loai: "dung_lai",
        buoc: "settle_lai",
        student_index: dl.student_index,
        gas_used: dl.settle_again.gas_used,
        block: dl.settle_again.block,
        status: dl.settle_again.status,
        tx_hash: dl.settle_again.hash,
        ghi_chu: `PHAI bi tu choi: ${dl.settle_again.revert_reason || dl.settle_again.send_error}`
    });

    for (const [ten, dat] of Object.entries(bangChung.level2_criteria)) {
        hang.push({
            ...chung,
            loai: "tieu_chi",
            buoc: ten,
            ghi_chu: dat ? "DAT" : "KHONG DAT"
        });
    }

    const rb = bangChung.root_rebuild_from_logs;

    hang.push({
        ...chung,
        loai: "tong_hop",
        buoc: "level2_reached",
        ghi_chu:
            `${bangChung.level2_reached};`
            + ` dung lai cay tu log: ${rb.commitments_in_log} commitment, khop root: ${rb.matches_current_root};`
            + ` nguon proof: ${bangChung.metadata.proof_source};`
            + ` baseline_same_circuit: ${bangChung.metadata.baseline_same_circuit}`
    });

    fs.writeFileSync(
        tep,
        COT.join(",") + "\n" + hang.map(dong).join("\n") + "\n",
        "utf8"
    );

    return tep;
}

function ghiCsvTuJson(duongDanJson: string): string {
    const bangChung = JSON.parse(fs.readFileSync(duongDanJson, "utf8"));
    const tep = duongDanJson.replace(/\.json$/, ".csv");

    return ghiCsv(bangChung, tep);
}

if (require.main === module) {
    const dd = process.argv[2];

    if (!dd) {
        console.error("can duong dan toi tep kiem_nghiem_*.json");
        process.exit(1);
    }

    console.log(ghiCsvTuJson(path.resolve(dd)));
}

module.exports = {
    ghiCsv,
    ghiCsvTuJson
};
