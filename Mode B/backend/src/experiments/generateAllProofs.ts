const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SCENARIOS =
    [1, 10, 30, 60, 100, 353, 500];

function getProjectRoot() {
    return path.resolve(
        __dirname,
        "../../.."
    );
}

function getProverDir() {
    return path.resolve(
        getProjectRoot(),
        "prover"
    );
}

function getProverPath() {
    return path.resolve(
        getProjectRoot(),
        process.platform === "win32"
            ? "target/release/prover.exe"
            : "target/release/prover"
    );
}

function runProverCommand(
    args: string[]
) {
    console.log(
        "\nRunning prover:",
        getProverPath(),
        args.join(" ")
    );

    const result =
        spawnSync(
            getProverPath(),
            args,
            {
                cwd: getProverDir(),
                encoding: "utf8",
                stdio: "inherit"
            }
        );

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(
            `Prover command failed: ${args.join(" ")}`
        );
    }
}

/*
 * Calldata cua MOT proof, tinh bang byte, o cau hinh HIEN TAI.
 *
 *   d = 7  ->  3 296 B      d = 9  ->  4 128 B
 *
 * Doi `MERKLE_DEPTH` thi PHAI doi hang so nay, neu khong khoa phuc hoi se
 * bo qua nham file sinh o depth cu.
 */
/*
 * A25 (12/09/2026): them `recipient` lam public input thu 4 nen calldata
 * di tu 4 128 B (96 B public input + 4 032 B proof) len 4 352 B
 * (128 B + 4 224 B). Hang so nay CHINH LA cai bay chong dung lai proof
 * sinh o cau hinh khac — de nguyen 4 128 thi lan chay sau A25 se BO QUA
 * het 7 kich ban va dem proof cu chay voi verifier moi, bao "out of gas".
 * Da dinh dung loi do 12/09.
 */
const EXPECTED_CALLDATA_BYTES = 4352;

/*
 * KHOA PHUC HOI — bo qua kich ban DA sinh xong.
 *
 * Vi sao can: `for (const n of SCENARIOS)` truoc day chay lai TAT CA moi
 * lan goi, ke ca 6 muc da xong. Muon chay lai rieng mot muc thi phai cho
 * het ~8 tieng thay vi ~3.
 *
 * 🔴 Kiem HAI dieu, khong phai mot:
 *   1. file `proofs_n<N>.json` co ton tai
 *   2. calldata trong do dung kich thuoc cua cau hinh HIEN TAI
 *
 * Chi kiem (1) la cai bay: doi `d` roi chay lai se BO QUA file sinh o depth
 * cu, cho ra mot bo so TRON HAI CAU HINH ma khong ai hay. Da suyt xay ra
 * that — `proofs_n{5,20,50}.json` cua d = 7 (calldata 3 296 B) van nam
 * chung thu muc voi file d = 9 (4 128 B).
 *
 * ⚠️ Khoa nay hoat dong o muc CA KICH BAN, khong phai tung proof. Prover
 * ghi file mot lan duy nhat o cuoi (`experiment.rs` fs::write), nen dut
 * giua chung van mat toan bo kich ban do — khoa chi giup khong phai lam
 * lai NHUNG KICH BAN KHAC.
 */
function scenarioAlreadyDone(
    n: number
) {
    const file = path.resolve(
        getProjectRoot(),
        "experiments/results/quantitative",
        `proofs_n${n}.json`
    );

    if (!fs.existsSync(file)) {
        return false;
    }

    let calldataBytes = 0;

    try {
        const parsed = JSON.parse(
            fs.readFileSync(file, "utf8")
        );

        const list = Array.isArray(parsed)
            ? parsed
            : parsed.proofs;

        const first = list && list[0];
        const blob = String(
            (first && (first.calldata || first.proof)) || ""
        );

        calldataBytes =
            blob.replace(/^0x/, "").length / 2;
    } catch (error) {
        console.log(
            `  n = ${n}: khong doc duoc ${file} -> SINH LAI`
        );
        return false;
    }

    if (calldataBytes !== EXPECTED_CALLDATA_BYTES) {
        console.log(
            `  n = ${n}: calldata ${calldataBytes} B != `
            + `${EXPECTED_CALLDATA_BYTES} B (cau hinh hien tai)`
            + " -> file CU, SINH LAI"
        );
        return false;
    }

    console.log(
        `  BO QUA n = ${n} — da co proof dung cau hinh`
        + ` (calldata ${calldataBytes} B).`
        + ` Xoa proofs_n${n}.json neu muon sinh lai.`
    );

    return true;
}

function main() {
    /*
     * 1. Export Halo2Verifier.sol.
     *
     * Hình dạng verifier phụ thuộc `merkle_depth` và `K`, KHÔNG phụ thuộc
     * `n`. Mọi dataset nay đều `merkle_depth = 9` nên xuất từ dataset nào
     * cũng ra cùng một verifier — giữ `n100` cho ổn định.
     *
     * ⚠️ Bước này GHI ĐÈ `contracts/contracts/Halo2Verifier.sol`, nên chạy
     * xong PHẢI `npx hardhat compile` rồi mới `experiment:gas`, không thì
     * gas đo trên verifier cũ.
     *
     * *(Chú thích cũ ghi "depth = 7 cố định" — đã đổi sang 9 ngày 2026-08-30.)*
     */
    runProverCommand([
        "export-verifier-from-dataset",
        "../experiments/data/dataset_n100.json"
    ]);

    // 2. Generate proof cho từng kịch bản
    for (const n of SCENARIOS) {
        if (scenarioAlreadyDone(n)) {
            continue;
        }

        runProverCommand([
            "bench-from-dataset",
            `../experiments/data/dataset_n${n}.json`
        ]);
    }
}

main();