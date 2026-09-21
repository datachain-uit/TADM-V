// =============================================================================
// BANG SO SANH BA NHANH — sinh lai duoc, muc 10.4 mức ②
//
// Doc gas CSV cua ca ba nhanh roi in bang doi chieu. Khong con so nao go tay.
//
// Chay:  npm run sosanh
//        npm run sosanh -- --json
//
// 🔴 CHI DOC hai repo kia. Khong ghi, khong sua gi ben do.
//
// -----------------------------------------------------------------------------
// CAP SO SANH — theo quy tac cua zk-halo2-onchain/reports/quantitative_onchain.md
// (khoi dinh chinh d = 9). SO THEO BUOC NGHIEP VU, khong theo ten ham:
//
//   Chi tien :  ADV `withdraw_gas`  <->  ONC/G16 `settle_gas`
//   Xac minh :  ADV khong co         <->  ONC/G16 `verify_record_gas`
//
// ⛔ CAM lay `ONC withdraw_gas / ADV withdraw_gas` — do la GOP chi phi chi tien
//    vao chi phi xac minh. Ti so ×7,9 cu ra tu phep gop nay va da bi bac.
// =============================================================================

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const CODE_ROOT =
    path.resolve(
        PROJECT_ROOT,
        "../.."
    );

const SCENARIOS =
    [1, 10, 30, 60, 100, 500];

// Do doc `update_root_gas` — gas moi la commitment duoc cong bo.
// Ky vong ~773: 32 byte × 16 gas/byte = 512, cong chi phi vong lap + event.
// Nguong 5 gas/la: du chat de bat mot nhanh cong bo THIEU hoac THUA du lieu,
// du rong cho khac biet so byte `0` trong calldata (hai ham bam khac nhau
// cho ra hai tap commitment khac nhau).
const NGUONG_DO_DOC = 5;

const NGUON: { ten: string; duong: string }[] = [
    {
        ten: "ADV",
        duong: "zk-circuits-halo2-advanced/experiments/results/quantitative/gas_offchain_raw.csv"
    },
    {
        ten: "ONC",
        duong: "zk-halo2-onchain/experiments/results/quantitative/gas_onchain_raw.csv"
    },
    {
        ten: "G16",
        duong: "baseline-comparisons/groth16-verifier/experiments/results/quantitative/gas_groth16_raw.csv"
    }
];

function docCsv(
    p: string
): Record<string, string>[] {

    const raw =
        fs.readFileSync(p, "utf8")
            .trim()
            .split(/\r?\n/);

    const dong0 = raw[0];

    if (dong0 === undefined) {
        throw new Error("File rong: " + p);
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

function tb(
    rows: Record<string, string>[],
    cot: string
): number | null {

    const v = rows
        .map((r) => r[cot])
        .filter(
            (x): x is string =>
                x !== undefined && x.trim() !== ""
        )
        .map(Number)
        .filter((x: number) => Number.isFinite(x));

    if (v.length === 0) {
        return null;
    }

    return v.reduce(
        (a: number, b: number) => a + b,
        0
    ) / v.length;
}

function so(
    x: number | null
): string {

    if (x === null) {
        return "—";
    }

    return Math.round(x)
        .toString()
        .replace(
            /\B(?=(\d{3})+(?!\d))/g,
            " "
        );
}

function tiSo(
    a: number | null,
    b: number | null
): string {

    if (a === null || b === null || b === 0) {
        return "—";
    }

    return (a / b).toFixed(2) + "×";
}

function main() {

    const d: any = {};
    const thieu: string[] = [];

    for (const n of NGUON) {

        const p =
            path.resolve(CODE_ROOT, n.duong);

        if (!fs.existsSync(p)) {
            thieu.push(n.ten);
            continue;
        }

        const rows = docCsv(p);

        const urg =
            rows
                .map((r) => r["update_root_gas"])
                .filter(
                    (x): x is string =>
                        x !== undefined && x.trim() !== ""
                )
                .map(Number)
                .filter((x: number) => Number.isFinite(x));

        // Trung binh `update_root_gas` THEO TUNG `n` — can cho phep kiem K1
        // dang moi (so DO DOC, xem ben duoi).
        const urgTheoN: Record<string, number> = {};

        for (const kb of SCENARIOS) {

            const cua =
                rows
                    .filter(
                        (r) => Number(r["n"]) === kb
                    )
                    .map(
                        (r) => Number(r["update_root_gas"])
                    )
                    .filter(
                        (x: number) => Number.isFinite(x)
                    );

            if (cua.length > 0) {
                urgTheoN[String(kb)] =
                    cua.reduce(
                        (a: number, b: number) => a + b,
                        0
                    ) / cua.length;
            }
        }

        d[n.ten] = {
            soMau: rows.length,
            update_root_min: urg.length > 0 ? Math.min(...urg) : null,
            update_root_max: urg.length > 0 ? Math.max(...urg) : null,
            update_root_theo_n: urgTheoN,
            deploy_pool_gas: tb(rows, "deploy_pool_gas"),
            deploy_verifier_gas: tb(rows, "deploy_verifier_gas"),
            update_root_gas: tb(rows, "update_root_gas"),
            verify_gas: tb(rows, "verify_gas"),
            withdraw_gas: tb(rows, "withdraw_gas"),
            verify_record_gas: tb(rows, "verify_record_gas"),
            settle_gas: tb(rows, "settle_gas")
        };
    }

    if (process.argv.indexOf("--json") !== -1) {
        console.log(
            JSON.stringify(
                { duLieu: d, thieu },
                null,
                2
            )
        );
        return;
    }

    console.log("# So sánh ba nhánh — gas");
    console.log("");
    console.log("> Sinh bằng `npm run sosanh`. **Không con số nào gõ tay.**");
    console.log("> Chỉ ĐỌC CSV của hai nhánh kia, không sửa gì bên đó.");

    if (thieu.length > 0) {
        console.log(
            "> ⚠️ Thiếu dữ liệu: **" + thieu.join(", ")
            + "** — chưa chạy hoặc chưa chốt."
        );
    }

    console.log("");
    console.log(
        "| | ADV | ONC | G16 |"
    );
    console.log("|---|---:|---:|---:|");
    console.log(
        "| số mẫu | " +
        ["ADV", "ONC", "G16"].map(
            (t: string) => d[t] ? String(d[t].soMau) : "—"
        ).join(" | ") + " |"
    );

    const dong = (
        ten: string,
        khoa: string
    ) => {
        console.log(
            "| `" + ten + "` | " +
            ["ADV", "ONC", "G16"].map(
                (t: string) => d[t] ? so(d[t][khoa]) : "—"
            ).join(" | ") + " |"
        );
    };

    dong("deploy_pool_gas", "deploy_pool_gas");
    dong("deploy_verifier_gas", "deploy_verifier_gas");
    // 🔴 KHONG in trung binh gop cho `update_root_gas` khi no TRAI RONG theo n.
    // ADV cong bo ca mang commitment (V4) nen cot nay chay tu ~73 000 den
    // ~459 000; trung binh gop cua day do la con so KHONG SINH VIEN NAO TON —
    // dung dang loi `503 252` ma CLAUDE.md canh bao. Trai rong thi in min-max.
    console.log(
        "| `update_root_gas` | " +
        ["ADV", "ONC", "G16"].map(
            (t: string) => {

                if (!d[t]) {
                    return "—";
                }

                const mn = d[t].update_root_min;
                const mx = d[t].update_root_max;

                if (mn === null || mx === null) {
                    return "—";
                }

                // Trai rong > 1 % thi dai luong nay KHONG co "trung binh"
                // co nghia — no la mot ham cua n, khong phai mot hang so.
                if (mx - mn > mn * 0.01) {
                    return so(mn) + " → " + so(mx) + " *(theo `n`)*";
                }

                return so(d[t].update_root_gas);
            }
        ).join(" | ") + " |"
    );
    dong("verify_gas", "verify_gas");
    dong("withdraw_gas", "withdraw_gas");
    dong("verify_record_gas", "verify_record_gas");
    dong("settle_gas", "settle_gas");

    // =========================
    // CAP SO SANH DUNG
    // =========================

    console.log("");
    console.log("## Cặp so sánh đúng — theo BƯỚC NGHIỆP VỤ");
    console.log("");
    console.log("| Bước | ADV | ONC | G16 | ONC/ADV | G16/ADV |");
    console.log("|---|---:|---:|---:|---:|---:|");

    const advChi =
        d["ADV"] ? d["ADV"].withdraw_gas : null;
    const oncChi =
        d["ONC"] ? d["ONC"].settle_gas : null;
    const g16Chi =
        d["G16"] ? d["G16"].settle_gas : null;

    console.log(
        "| **Chi tiền** | " + so(advChi) + " | " + so(oncChi)
        + " | " + so(g16Chi) + " | " + tiSo(oncChi, advChi)
        + " | " + tiSo(g16Chi, advChi) + " |"
    );

    const oncXac =
        d["ONC"] ? d["ONC"].verify_record_gas : null;
    const g16Xac =
        d["G16"] ? d["G16"].verify_record_gas : null;

    console.log(
        "| **Xác minh** | *(không có cơ chế)* | " + so(oncXac)
        + " | " + so(g16Xac) + " | " + tiSo(oncXac, advChi)
        + " | " + tiSo(g16Xac, advChi) + " |"
    );

    console.log("");
    console.log(
        "⛔ **Đừng lấy `ONC withdraw_gas / ADV withdraw_gas`** — đó là gộp chi phí chi tiền"
        + " vào chi phí xác minh. Tỉ số `×7,9` cũ ra từ phép gộp đó và đã bị bác."
    );
    console.log("");
    console.log(
        "📌 `verify_gas` và `deploy_verifier_gas` của **ADV để TRỐNG**, không phải `0` —"
        + " cơ chế không tồn tại, không phải miễn phí."
    );
    console.log("");
    console.log(
        "📌 **`update_root_gas` nay TĂNG THEO `n` ở CẢ BA NHÁNH** *(đồng bộ K19,"
        + " 2026-09-09)*. Cả ba đều công bố mảng commitment lên chuỗi (V4), ~773 gas"
        + " mỗi lá. Trước K19, ONC và G16 truyền mảng **rỗng** nên cột này đứng im và"
        + " **đang đo một việc khác với ADV** — chính ONC ghi rằng khi đó *\"K1 mất ý"
        + " nghĩa\"*."
    );
    console.log("");
    console.log(
        "🔴 **Vì thế K1 KHÔNG còn so trị tuyệt đối được.** Ba nhánh dùng ba hàm băm"
        + " khác nhau ⇒ ba tập commitment khác nhau ⇒ số byte `0` trong calldata khác"
        + " nhau. Mỗi byte `0` rẻ hơn 12 gas, và ở `n = 500` có ~16 000 byte, nên chênh"
        + " lệch hàng trăm gas là **bình thường, không phải lỗi**."
    );
    console.log(
        "   ⇒ Đại lượng bất biến là **ĐỘ DỐC — gas mỗi lá**. Nó nói cả ba nhánh công bố"
        + " **cùng một lượng dữ liệu cho mỗi commitment**, và đó mới là điều K1 cần khẳng"
        + " định. Ngưỡng: **" + NGUONG_DO_DOC + " gas/lá**."
    );

    // =========================
    // PHEP KIEM CHEO
    // =========================

    console.log("");
    console.log("## Phép kiểm chéo");
    console.log("");
    console.log("| Phép kiểm | Kỳ vọng | Kết quả |");
    console.log("|---|---|---|");

    // ---------------------------------------------------------------------
    // K1 (ban moi, sau K19) — so DO DOC `update_root_gas`, khong so tri
    // tuyet doi. Xem ghi chu o tren.
    // ---------------------------------------------------------------------

    const doDoc = (
        t: string
    ): { doc: number; tu: number; den: number } | null => {

        if (!d[t] || !d[t].update_root_theo_n) {
            return null;
        }

        const co =
            Object.keys(d[t].update_root_theo_n)
                .map(Number)
                .sort(
                    (a: number, b: number) => a - b
                );

        const tu = co[0];
        const den = co[co.length - 1];

        if (tu === undefined || den === undefined || den === tu) {
            return null;
        }

        return {
            doc:
                (d[t].update_root_theo_n[String(den)]
                    - d[t].update_root_theo_n[String(tu)])
                / (den - tu),
            tu,
            den
        };
    };

    const docs =
        ["ADV", "ONC", "G16"].map(
            (t: string) => ({ ten: t, kq: doDoc(t) })
        ).filter(
            (x): x is { ten: string; kq: { doc: number; tu: number; den: number } } =>
                x.kq !== null
        );

    if (docs.length >= 2) {

        const gt =
            docs.map(
                (x) => x.kq.doc
            );

        const lech =
            Math.max(...gt) - Math.min(...gt);

        console.log(
            "| **K1** độ dốc `update_root_gas` *(gas mỗi lá)* | ba nhánh lệch ≤ "
            + NGUONG_DO_DOC + " gas/lá | "
            + (lech <= NGUONG_DO_DOC ? "✅" : "🔴") + " "
            + docs.map(
                (x) => x.ten + " **" + x.kq.doc.toFixed(1) + "**"
            ).join(" · ")
            + " *(lệch " + lech.toFixed(1) + ")* |"
        );
    } else {
        console.log(
            "| **K1** độ dốc `update_root_gas` | ba nhánh lệch ≤ "
            + NGUONG_DO_DOC + " gas/lá | ⬜ chưa đủ dữ liệu *(cần ≥ 2 kịch bản"
            + " ở ≥ 2 nhánh)* |"
        );
    }

    if (d["ONC"] && d["G16"]) {

        const l =
            Math.abs(
                d["ONC"].update_root_gas - d["G16"].update_root_gas
            );

        // 🔴 KHONG con la phep kiem DAT/KHONG DAT — chi la so tham khao.
        //
        // Truoc K19 dong nay so tri tuyet doi voi nguong 100 gas, va no co
        // nghia vi ONC lan G16 deu truyen mang RONG nen ca hai deu la hang so.
        // Sau K19 ca hai cong bo mang that: ba ham bam khac nhau cho ba tap
        // commitment khac nhau, so byte `0` trong calldata khac nhau, moi byte
        // `0` re hon 12 gas — o `n = 500` la ~16 000 byte, nen lech hang tram
        // gas la BINH THUONG.
        //
        // Dat nguong tuyet doi o day nghia la bao do mot thu khong sai. Phep
        // kiem that da chuyen sang DO DOC (dong K1 o tren).
        console.log(
            "| *(tham khảo)* hiệu trung bình `update_root_gas` ONC ↔ G16 |"
            + " **không phải phép kiểm** — xem K1 độ dốc | ⬜ lệch "
            + so(l) + " gas |"
        );

        const gapOnc =
            d["ONC"].verify_record_gas + d["ONC"].settle_gas
            - d["ONC"].withdraw_gas;

        const gapG16 =
            d["G16"].verify_record_gas + d["G16"].settle_gas
            - d["G16"].withdraw_gas;

        const lech =
            Math.abs(gapOnc - gapG16);

        console.log(
            "| **Giá của việc tách hai giai đoạn** | gần bằng nhau — nó là phí giao dịch thứ hai"
            + " + ghi `Claim`, không dính hệ chứng minh | "
            + (lech < 20000 ? "✅" : "🔴")
            + " ONC **+" + so(gapOnc) + "** · G16 **+" + so(gapG16)
            + "** (lệch " + so(lech) + ") |"
        );
    }
}

main();
