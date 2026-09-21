// =============================================================================
// SINH LAI BANG TONG HOP TU experiments/results/  —  muc 10.4 mức ②
//
// "Moi bang trong reports/*.md phai TINH LAI DUOC tu experiments/results/
//  bang mot lenh — khong con so nao chi ton tai trong .md."
//
// Chay:  npm run tonghop            -> in bang markdown ra stdout
//        npm run tonghop -- --json  -> in JSON de may doc
//
// TAT DINH: cung file CSV vao => cung bang ra. Khong goi mang, khong doc
// thoi gian he thong. Chay lai bao nhieu lan cung ra y het.
//
// Quy uoc thong ke (muc 7): TRUNG BINH CONG, khong dung trung vi. Kem N va
// sigma. KHONG dung "±" tran — su co ±52 xay ra dung vi bo qua dieu nay.
// =============================================================================

const fs = require("fs");
const path = require("path");

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

const SCENARIOS =
    [1, 10, 30, 60, 100, 500];

// Dung DU 6 cot gas. `withdraw_gas` tung bi bo sot o ban dau (luc do contract
// chua co ham withdraw) — them lai 2026-09-07, neu khong thi bang tong hop im
// lang thieu mot duong do ma nhin khong ra.
const COT_GAS = [
    "deploy_pool_gas",
    "deploy_verifier_gas",
    "update_root_gas",
    "verify_gas",
    "withdraw_gas",
    "verify_record_gas",
    "settle_gas"
];

const COT_MS = [
    "verify_onchain_ms",
    "withdraw_ms",
    "verify_record_ms",
    "settle_ms"
];

const COT_PERF = [
    "witness_ms",
    "setup_ms",
    "prove_ms",
    "proof_generation_ms",
    "verify_native_ms",
    "proof_bytes",
    "calldata_bytes"
];

// =========================
// DOC CSV
// =========================

function docCsv(
    p: string
): Record<string, string>[] {

    const raw =
        fs.readFileSync(p, "utf8")
            .trim()
            .split(/\r?\n/);

    const dong0 = raw[0];

    if (dong0 === undefined) {
        throw new Error(
            "File rong: " + p
        );
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

// =========================
// THONG KE
// =========================

type ThongKe = {
    n: number;
    tb: number;
    min: number;
    max: number;
    sigma: number;
};

function thongKe(
    v: number[]
): ThongKe | null {

    if (v.length === 0) {
        return null;
    }

    const tb =
        v.reduce(
            (a: number, b: number) => a + b,
            0
        ) / v.length;

    const sigma =
        Math.sqrt(
            v.reduce(
                (a: number, b: number) => a + (b - tb) * (b - tb),
                0
            ) / v.length
        );

    return {
        n: v.length,
        tb,
        min: Math.min(...v),
        max: Math.max(...v),
        sigma
    };
}

function lay(
    rows: Record<string, string>[],
    cot: string
): number[] {

    return rows
        .map(
            (r) => r[cot]
        )
        .filter(
            (x): x is string =>
                x !== undefined && x.trim() !== ""
        )
        .map(Number)
        .filter(
            (x: number) => Number.isFinite(x)
        );
}

function so(
    x: number,
    le: number
): string {

    const s =
        x.toFixed(le);

    const phan =
        s.split(".");

    const nguyen =
        phan[0] ?? "0";

    const nhom =
        nguyen.replace(
            /\B(?=(\d{3})+(?!\d))/g,
            " "
        );

    return phan.length > 1
        ? nhom + "," + phan[1]
        : nhom;
}

// =========================
// MAIN
// =========================

function main() {

    const gasPath =
        path.resolve(
            RESULT_DIR,
            "gas_groth16_raw.csv"
        );

    if (!fs.existsSync(gasPath)) {
        throw new Error(
            "Thieu " + gasPath + " — chua chay experiment:gas."
        );
    }

    const gas =
        docCsv(gasPath);

    const theoN: any = {};

    for (const n of SCENARIOS) {

        const rG =
            gas.filter(
                (r) => Number(r["n"]) === n
            );

        if (rG.length === 0) {
            continue;
        }

        const muc: any = {
            n,
            soMau: rG.length
        };

        for (const c of COT_GAS.concat(COT_MS)) {
            muc[c] = thongKe(lay(rG, c));
        }

        const perfPath =
            path.resolve(
                RESULT_DIR,
                "performance_groth16_n" + n + ".csv"
            );

        if (fs.existsSync(perfPath)) {

            const rP =
                docCsv(perfPath);

            for (const c of COT_PERF) {
                muc[c] = thongKe(lay(rP, c));
            }
        }

        theoN[n] = muc;
    }

    if (process.argv.indexOf("--json") !== -1) {
        console.log(
            JSON.stringify(theoN, null, 2)
        );
        return;
    }

    const co =
        Object.keys(theoN).map(Number);

    const tongMau =
        co.reduce(
            (a: number, n: number) => a + theoN[n].soMau,
            0
        );

    console.log("# Tổng hợp định lượng — baseline Groth16");
    console.log("");
    console.log("> Sinh bằng `npm run tonghop` từ `experiments/results/quantitative/`.");
    console.log("> **Không con số nào trong file này được gõ tay.** Chạy lại lệnh ra y hệt.");
    console.log(
        "> Tổng **" + so(tongMau, 0) + "** mẫu · "
        + co.length + " kịch bản · trung bình cộng, kèm N và σ."
    );
    console.log("");

    const bang = (
        ten: string,
        cot: string[],
        le: number
    ) => {
        console.log("## " + ten);
        console.log("");
        console.log("| n | số mẫu | " + cot.join(" | ") + " |");
        console.log(
            "|---:|---:|"
            + cot.map(() => "---:").join("|")
            + "|"
        );

        for (const n of co) {
            const m = theoN[n];
            const o = cot.map(
                (c: string) =>
                    m[c] ? so(m[c].tb, le) : "—"
            );
            console.log(
                "| " + n + " | " + m.soMau + " | "
                + o.join(" | ") + " |"
            );
        }
        console.log("");
    };

    bang("Gas", COT_GAS, 0);
    bang("Thời gian trên chuỗi (ms)", COT_MS, 1);
    bang("Thời gian sinh proof (ms) và kích thước", COT_PERF, 1);

    // =========================
    // PHEP TU KIEM
    // =========================

    console.log("## Phép tự kiểm");
    console.log("");
    console.log("| Phép kiểm | Ngưỡng | Kết quả |");
    console.log("|---|---|---|");

    let k2 = true;
    const bd: string[] = [];

    for (const n of co) {
        const s = theoN[n]["settle_gas"];
        if (s) {
            const b = s.max - s.min;
            if (b >= 1000) {
                k2 = false;
            }
            bd.push(String(b));
        }
    }

    console.log(
        "| **K2** biên độ `settle_gas` trong một kịch bản | < 1 000 gas | "
        + (k2 ? "✅" : "🔴") + " " + bd.join(" · ") + " |"
    );

    const tb =
        co.map(
            (n: number) => theoN[n]["settle_gas"]
        ).filter(
            (x: ThongKe | null): x is ThongKe => x !== null && x !== undefined
        ).map(
            (x: ThongKe) => x.tb
        );

    if (tb.length > 0) {

        const trungBinh =
            tb.reduce(
                (a: number, b: number) => a + b,
                0
            ) / tb.length;

        const bienDo =
            (Math.max(...tb) - Math.min(...tb)) / trungBinh;

        console.log(
            "| **K3** `settle_gas` trung bình phẳng qua " + tb.length
            + " kịch bản | biên độ < 1 % | "
            + (bienDo < 0.01 ? "✅" : "🔴") + " "
            + (bienDo * 100).toFixed(3) + " % |"
        );
    }

    console.log("");
    console.log(
        "📌 **K1** *(so `update_root_gas` với ADV/ONC)* phải đối chiếu thủ công — "
        + "nó cần số của hai nhánh kia."
    );
    console.log("");
    console.log(
        "📌 Mỗi con số trên là **trung bình cộng**. Muốn min/max/σ thì chạy "
        + "`npm run tonghop -- --json`."
    );
}

main();
