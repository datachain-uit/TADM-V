const {
    issueScholarshipController
} = require("../controllers/scholarshipController");

async function runIssueScholarshipCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentIdRaw] = args;
    const studentId = Number(studentIdRaw);

    if (!universityId || !staffId || !studentIdRaw) {
        throw new Error(
            "Usage: npx ts-node src/cli/issueScholarshipCli.ts <universityId> <staffId> <studentId>"
            + " | staffId phai co role STUDENT_AFFAIRS"
        );
    }

    return issueScholarshipController(
        universityId,
        staffId,
        studentId
    );
}

module.exports = {
    runIssueScholarshipCli
};

if (require.main === module) {
    runIssueScholarshipCli().catch((error: any) => {
        console.error("\nISSUE SCHOLARSHIP FAILED");
        console.error(error);
        process.exitCode = 1;
    });
}
