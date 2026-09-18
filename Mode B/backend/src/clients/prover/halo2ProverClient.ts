const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/*
 * Adapter duy nhất gọi binary Rust/Halo2.
 *
 * Tách ra khỏi services/generateStudentFile.ts khi refactor 2026-08-18 —
 * cùng vai trò với clients/blockchain (Web3) và clients/ipfs (daemon):
 * nó là cổng ra một tiến trình bên ngoài, không phải nghiệp vụ.
 *
 * Nội dung ba hàm giữ NGUYÊN VĂN từ bản trước, không đổi hành vi.
 */

function projectRoot() {
    return path.resolve(__dirname, "../../../..");
}

function proverBinary() {
    return process.env.PROVER_BIN
        ? path.resolve(process.env.PROVER_BIN)
        : path.join(
            projectRoot(),
            "target",
            "release",
            process.platform === "win32" ? "prover.exe" : "prover",
        );
}

function parseJsonOutput(stdout: string) {
    const lines = stdout.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            return JSON.parse(lines[index] as string);
        } catch (_) {
            // The Rust prover may print progress lines before the final JSON line.
        }
    }
    throw new Error("Prover stdout did not contain JSON");
}

function runProver(mode: "commitment" | "nullifier" | "root" | "prove" | "rho", payload: unknown) {
    if (!fs.existsSync(proverBinary())) {
        throw new Error(`Missing release prover at ${proverBinary()}; run cargo build --release -p prover`);
    }
    const result = spawnSync(proverBinary(), [mode], {
        cwd: path.join(projectRoot(), "prover"),
        input: JSON.stringify(payload),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Halo2 prover ${mode} failed (exit ${result.status}):\n${result.stderr}`);
    }
    return parseJsonOutput(result.stdout);
}

module.exports = {
    projectRoot,
    proverBinary,
    parseJsonOutput,
    runProver
};
