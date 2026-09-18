const {
    issueScholarshipController
} = require("../controllers/scholarshipController");
const {
    printJson
} = require("../utils/serviceOutput");

async function runIssueScholarshipCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentId] = args;

    if (!universityId || !staffId || !studentId) {
        throw new Error(
            "Usage: npx ts-node src/cli/issueScholarshipCli.ts <universityId> <staffId> <studentId>"
            + " | staffId phai co role STUDENT_AFFAIRS"
        );
    }

    printJson(
        await issueScholarshipController(universityId, staffId, studentId)
    );
}

module.exports = {
    runIssueScholarshipCli
};

if (require.main === module) {
    runIssueScholarshipCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
