const fs = require("fs");
const path = require("path");
const {
    runQualitativeExperiment
} = require("../experiments/qualitativeExperiment");
const {
    disconnectDatabase
} = require("../config/database");

async function runQualitativeExperimentCli(
    args: string[] = process.argv.slice(2)
) {
    const [configurationPath] = args;

    if (!configurationPath) {
        throw new Error(
            "Usage: npm run experiment:qualitative -- <configuration.json>"
        );
    }

    const config = JSON.parse(
        fs.readFileSync(
            path.resolve(configurationPath),
            "utf8"
        )
    );
    let output: any;

    try {
        output = await runQualitativeExperiment(config);
    } finally {
        /*
         * Runner mo ket noi MongoDB VO DIEU KIEN o dau luot va KHONG dong.
         * Khong dong thi event loop con song: tien trinh ghi xong artifact
         * roi TREO. Da gap that 13/09/2026 — luot n = 1 ghi ket qua luc
         * 03:12:43 roi dung do cho toi khi bi giet.
         *
         * ADV khong gap vi buoc rut tien di qua controller co
         * withDatabaseCleanup, dong ket noi truoc phan on-chain cuoi luot.
         * Dong o CLI thay vi sua runner de khong dung vao runner.
         */
        await disconnectDatabase();
    }

    console.log(
        "QUALITATIVE EXPERIMENT RESULT:",
        output.outputPath
    );
    /*
     * Ten khoa PHAI khop `csvPaths` cua runner. Doi ten trong runner ma
     * quen file nay thi in ra `undefined` — da gap that 2026-08-24.
     */
    console.log(
        "  CSV 1 (5 criteria)        :",
        output.csvPaths.criteria
    );
    console.log(
        "  CSV 2 (C3 amount binding) :",
        output.csvPaths.amountBinding
    );
    console.log(
        "  CSV 3 (measurement + limits):",
        output.csvPaths.appendix
    );

    // Chi co khi soSinhVien > 1.
    if (output.csvPaths.students) {
        console.log(
            "  CSV 4 (per student)       :",
            output.csvPaths.students
        );
    }

    return output;
}

module.exports = {
    runQualitativeExperimentCli
};

if (require.main === module) {
    runQualitativeExperimentCli().catch((error: any) => {
        console.error("QUALITATIVE EXPERIMENT FAILED");
        console.error(error);
        process.exitCode = 1;
    });
}
