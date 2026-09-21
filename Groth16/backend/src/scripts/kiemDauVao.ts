// =============================================================================
// KIEM "BA NHANH CUNG DAU VAO" — muc 10.4 mức ②
//
// Cau hoi can tra loi bang MOT LENH, khong bang mot lan doi chieu thu cong:
//
//   "Baseline co dung cung dau vao voi hai nhanh chinh khong?"
//
// Chay:  npm run kiemdauvao
//        npm run kiemdauvao -- --json
//
// 🔴 CHI DOC hai repo kia. Khong ghi, khong sua gi ben do.
//
// -----------------------------------------------------------------------------
// CHUOI TUONG DUONG duoc kiem, ba mat xich:
//
//   ADV dataset_n*.json  ==(noi dung)==  ONC dataset_n*.json
//                                             |
//                                             | (doc THANG, khong sao chep)
//                                             v
//                                     G16 inputs_n*.json
//
// Mat xich 1 la dieu `CLAUDE.md` da khang dinh; kiem lai o day de neu no vo thi
// bao cao biet ngay, chu khong de bai bao noi "cung dau vao" dua tren tri nho.
//
// Mat xich 2 la mat xich MOI cua baseline, va la mat xich dang ngo nhat: neu
// `prepareInputs.ts` lo SINH LAI `rho` thay vi doc ra, moi con so van chay
// binh thuong, chi co cau "cung dau vao" la sai. Khong co phep kiem nao khac
// bat duoc loi do.
//
// ⚠️ KHONG so SHA-256 tho cua file: ADV dung CRLF, ONC dung LF, nen bam tho
//    LECH o ca bay file du noi dung y het. So theo BO BA (student_id, amount,
//    rho) — do moi la thu di vao mach. Xem `CLAUDE.md`, khoi dinh chinh
//    2026-08-25 ve "byte-identical".
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

const DUONG_ADV =
    "zk-circuits-halo2-advanced/experiments/data";

const DUONG_ONC =
    "zk-halo2-onchain/experiments/data";

const DUONG_G16 =
    "baseline-comparisons/groth16-verifier/experiments/data";

// =========================
// DOC
// =========================

function docJson(
    p: string
): any {

    return JSON.parse(
        fs.readFileSync(p, "utf8")
    );
}

type BoBa = {
    student_id: string;
    amount: string;
    rho: string;
};

// Dataset cua ADV/ONC: { students: [ { student_id, amount, note: { rho } } ] }
function boBaTuDataset(
    d: any
): BoBa[] {

    const ds: any[] =
        d.students ?? [];

    return ds.map(
        (
            r: any
        ) => ({
            student_id: String(r.student_id),
            amount: String(r.amount),
            rho: String(r.note?.rho ?? "")
        })
    );
}

// Input mach cua G16: { inputs: [ { input: { student_id, amount, rho } } ] }
function boBaTuInputs(
    d: any
): BoBa[] {

    const ds: any[] =
        d.inputs ?? [];

    return ds.map(
        (
            r: any
        ) => ({
            student_id: String(r.input?.student_id ?? ""),
            amount: String(r.input?.amount ?? ""),
            rho: String(r.input?.rho ?? "")
        })
    );
}

function bang(
    a: BoBa[],
    b: BoBa[]
): { khop: boolean; soLech: number; viDu: string } {

    if (a.length !== b.length) {
        return {
            khop: false,
            soLech: Math.abs(a.length - b.length),
            viDu: "so ban ghi lech: " + a.length + " so voi " + b.length
        };
    }

    let soLech = 0;
    let viDu = "";

    for (let i = 0; i < a.length; i++) {

        const x = a[i];
        const y = b[i];

        if (x === undefined || y === undefined) {
            soLech++;
            continue;
        }

        if (
            x.student_id !== y.student_id
            || x.amount !== y.amount
            || x.rho !== y.rho
        ) {
            soLech++;

            if (viDu === "") {
                viDu =
                    "ban ghi #" + i + ": "
                    + JSON.stringify(x) + " so voi " + JSON.stringify(y);
            }
        }
    }

    return {
        khop: soLech === 0,
        soLech,
        viDu
    };
}

// =========================
// MAIN
// =========================

function main() {

    const ketQua: any[] = [];

    for (const n of SCENARIOS) {

        const pAdv =
            path.resolve(
                CODE_ROOT,
                DUONG_ADV,
                "dataset_n" + n + ".json"
            );

        const pOnc =
            path.resolve(
                CODE_ROOT,
                DUONG_ONC,
                "dataset_n" + n + ".json"
            );

        const pG16 =
            path.resolve(
                CODE_ROOT,
                DUONG_G16,
                "inputs_n" + n + ".json"
            );

        const co = {
            adv: fs.existsSync(pAdv),
            onc: fs.existsSync(pOnc),
            g16: fs.existsSync(pG16)
        };

        if (!co.adv || !co.onc || !co.g16) {

            ketQua.push({
                n,
                thieu: Object.keys(co).filter(
                    (k: string) => !(co as any)[k]
                )
            });

            continue;
        }

        const dAdv = docJson(pAdv);
        const dOnc = docJson(pOnc);
        const dG16 = docJson(pG16);

        const bAdv = boBaTuDataset(dAdv);
        const bOnc = boBaTuDataset(dOnc);
        const bG16 = boBaTuInputs(dG16);

        // `nguon_dataset` la bang chung G16 DOC THANG file cua ONC chu khong
        // giu mot ban sao rieng. Neu truong nay tro sang cho khac, mat xich 2
        // khong con y nghia du bo ba van khop.
        const nguon =
            String(dG16.nguon_dataset ?? "(khong ghi)");

        const troSangOnc =
            nguon.replace(/\\/g, "/").indexOf("zk-halo2-onchain") !== -1;

        ketQua.push({
            n,
            soBanGhi: {
                adv: bAdv.length,
                onc: bOnc.length,
                g16: bG16.length
            },
            depth: {
                adv: dAdv.merkle_depth,
                onc: dOnc.merkle_depth,
                g16: dG16.merkle_depth
            },
            advVsOnc: bang(bAdv, bOnc),
            oncVsG16: bang(bOnc, bG16),
            nguon,
            troSangOnc
        });
    }

    if (process.argv.indexOf("--json") !== -1) {
        console.log(
            JSON.stringify(ketQua, null, 2)
        );
        return;
    }

    console.log("# Kiểm đầu vào ba nhánh");
    console.log("");
    console.log("> Sinh bằng `npm run kiemdauvao`. Chỉ ĐỌC hai repo kia.");
    console.log(
        "> So theo **bộ ba `(student_id, amount, rho)`** — thứ thật sự đi vào mạch."
    );
    console.log(
        "> ⚠️ **Không** so SHA-256 thô: ADV dùng CRLF, ONC dùng LF nên băm thô lệch"
        + " ở cả bảy file dù nội dung y hệt."
    );
    console.log("");
    console.log(
        "| n | bản ghi | `d` | ADV ↔ ONC | ONC ↔ G16 | G16 đọc thẳng ONC |"
    );
    console.log("|---:|---:|---:|---|---|---|");

    let tong = 0;
    let dat = true;

    for (const r of ketQua) {

        if (r.thieu) {
            dat = false;
            console.log(
                "| " + r.n + " | — | — | — | — | 🔴 thiếu: "
                + r.thieu.join(", ") + " |"
            );
            continue;
        }

        tong += r.soBanGhi.onc;

        const dOk =
            r.depth.adv === r.depth.onc
            && r.depth.onc === r.depth.g16;

        if (!r.advVsOnc.khop || !r.oncVsG16.khop || !r.troSangOnc || !dOk) {
            dat = false;
        }

        console.log(
            "| " + r.n
            + " | " + r.soBanGhi.onc
            + " | " + (dOk ? r.depth.onc : "🔴 " + JSON.stringify(r.depth))
            + " | " + (r.advVsOnc.khop ? "✅" : "🔴 lệch " + r.advVsOnc.soLech)
            + " | " + (r.oncVsG16.khop ? "✅" : "🔴 lệch " + r.oncVsG16.soLech)
            + " | " + (r.troSangOnc ? "✅" : "🔴 " + r.nguon)
            + " |"
        );
    }

    console.log("");
    console.log(
        "**Tổng " + tong + " bản ghi** · "
        + (dat
            ? "✅ **cả ba nhánh cùng đầu vào** — câu *\"cùng đầu vào\"* dùng được."
            : "🔴 **CÓ LỆCH** — chưa được viết *\"cùng đầu vào\"* vào bài.")
    );

    if (!dat) {

        console.log("");
        console.log("Chi tiết chỗ lệch đầu tiên:");

        for (const r of ketQua) {
            if (r.advVsOnc && !r.advVsOnc.khop) {
                console.log("- n=" + r.n + " ADV↔ONC: " + r.advVsOnc.viDu);
            }
            if (r.oncVsG16 && !r.oncVsG16.khop) {
                console.log("- n=" + r.n + " ONC↔G16: " + r.oncVsG16.viDu);
            }
        }
    }

    console.log("");
    console.log(
        "📌 Mắt xích **ONC ↔ G16** là mắt xích đáng ngờ nhất: nếu `prepareInputs.ts`"
        + " lỡ **sinh lại** `rho` thay vì đọc ra, mọi con số vẫn chạy bình thường và"
        + " chỉ riêng câu *\"cùng đầu vào\"* là sai. Không phép kiểm nào khác bắt được."
    );

    if (!dat) {
        process.exitCode = 1;
    }
}

main();
