const fs = require("fs");
const path = require("path");
const {
    runQualitativeExperiment
} = require("../experiments/qualitativeExperiment");

async function runQualitativeExperimentCli(
    args: string[] = process.argv.slice(2)
) {
    const [configurationPath] = args;

    if (!configurationPath) {
        throw new Error(
            "Usage: npm run experiment:qualitative -- <configuration.json>"
        );
    }

    const absolutePath = path.resolve(configurationPath);
    const config = JSON.parse(
        fs.readFileSync(absolutePath, "utf8")
    );
    const output = await runQualitativeExperiment(config);

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
