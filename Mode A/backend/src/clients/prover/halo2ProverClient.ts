const {
    spawnSync
} = require("child_process");
const path = require("path");

type ProverMode =
    "setup"
    | "commitment"
    | "nullifier"
    | "root"
    | "prove"
    | "verify"
    // A26 — lấy mẫu `rho` trong trường, ở Rust.
    | "rho"
    // LAP20 — kiểm K đủ hàng cho MERKLE_DEPTH (đặt qua biến môi trường).
    | "check-k"
    /*
     * LAP20 (17/09/2026) — sinh n proof trong MỘT tiến trình, keygen một lần
     * cho cả lượt. Payload là một MẢNG sinh viên, không phải một sinh viên.
     * Dùng để đo ở cùng điều kiện với nhánh on-chain; mode `prove` không đổi.
     */
    | "prove-batch";

function getProverPath(): string {
    return path.resolve(
        __dirname,
        "../../../../target/release/prover.exe"
    );
}

function runRust(mode: ProverMode, payload: any) {
    const result = spawnSync(
        getProverPath(),
        [mode],
        {
            input: JSON.stringify(payload),
            encoding: "utf8",
            /*
             * LAP20 (17/09/2026) — nâng từ 10 MB. Mode `prove-batch` trả về
             * cả n proof trong một lần: ở n = 500 là ~3,3 MB proof hex cộng
             * phần JSON, sát trần cũ. Nâng trần không đổi hành vi của mode
             * nào — chỉ cho phép đầu ra lớn hơn.
             */
            maxBuffer: 256 * 1024 * 1024
        }
    );

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        console.error("RUST STDERR:", result.stderr);
        throw new Error(`Rust ${mode} mode failed`);
    }

    if (result.stderr) {
        console.log("RUST STDERR:", result.stderr);
    }

    const stdout = result.stdout.trim();

    if (!stdout) {
        throw new Error(
            `Rust ${mode} mode returned empty stdout`
        );
    }

    return JSON.parse(stdout);
}

module.exports = {
    getProverPath,
    runRust
};
