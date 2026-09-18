/*
 * Xuất bằng chứng kiểm nghiệm Sepolia (JSON) ra CSV — nhánh OFF-CHAIN.
 *
 * Vì sao có file này: tệp JSON là bản đầy đủ, nhưng bài báo cần một bảng đọc
 * được thẳng. CSV này là BẢN CHUYỂN DẠNG, không phải phép đo mới — mọi con số
 * đều lấy nguyên từ JSON, không tính lại gì cả.
 *
 * Dùng hai kiểu:
 *   - sepoliaValidation.ts gọi ghiCsv(bangChung, tệp) ngay sau khi ghi JSON
 *   - chạy tay trên một tệp JSON đã có:
 *       node -r ts-node/register src/experiments/sepoliaCsv.ts <đường dẫn .json>
 *
 * Cột:
 *   loai      trien_khai | duyet_root | rut | dung_lai | tieu_chi | tong_hop
 *   buoc      tên bước / tên tiêu chí
 *   gas_used  gas THẬT trên mạng; ganache_gas_used là mốc để đối chiếu
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
            + ` sàn EIP-7623 ${u.calldata.eip7623_floor_gas};`
            + ` gas bằng sàn: ${u.gas_equals_eip7623_floor}`
    });

    for (const r of bangChung.withdrawals) {
        hang.push({
            ...chung,
            loai: "rut",
            buoc: "withdrawOffChain",
            student_index: r.student_index,
            gas_used: r.tx.gas_used,
            ganache_gas_used: r.ganache_gas_used,
            delta_vs_ganache: r.delta_vs_ganache,
            thoi_gian_ms: r.offchain_verify_ms,
            block: r.tx.block,
            status: r.tx.status,
            tx_hash: r.tx.hash,
            ghi_chu:
                `ví nhận ${r.recipient}; ví đã tồn tại: ${r.recipient_existed_before};`
                + ` thoi_gian_ms là verify off-chain (tiến trình prover riêng);`
                + ` nullifier đánh dấu đã dùng: ${r.nullifier_marked_used}`
        });
    }

    const dl = bangChung.nullifier_replay;

    hang.push({
        ...chung,
        loai: "dung_lai",
        buoc: "withdrawOffChain_lai",
        student_index: dl.student_index,
        gas_used: dl.gas_used,
        block: dl.block,
        status: dl.status,
        tx_hash: dl.hash,
        ghi_chu: `PHẢI bị từ chối: ${dl.revert_reason || dl.send_error}`
    });

    for (const [ten, dat] of Object.entries(bangChung.level2_criteria)) {
        hang.push({
            ...chung,
            loai: "tieu_chi",
            buoc: ten,
            ghi_chu: dat ? "ĐẠT" : "KHÔNG ĐẠT"
        });
    }

    const rb = bangChung.root_rebuild_from_logs;

    hang.push({
        ...chung,
        loai: "tong_hop",
        buoc: "level2_reached",
        ghi_chu:
            `${bangChung.level2_reached};`
            + ` dựng lại cây từ log: ${rb.commitments_in_log} commitment, khớp root: ${rb.matches_current_root};`
            + ` nguồn proof: ${bangChung.metadata.proof_source};`
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
        console.error("cần đường dẫn tới tệp kiem_nghiem_*.json");
        process.exit(1);
    }

    console.log(ghiCsvTuJson(path.resolve(dd)));
}

module.exports = {
    ghiCsv,
    ghiCsvTuJson
};
