const { authorizeStaff } = require("./authorizeStaffService");
const { University } = require("../models/University");
const { UniversityStudent } = require("../models/UniversityStudent");

function parseStudentId(value: string | number) {
    const studentId = Number(value);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) throw new Error("studentId must be a positive integer");
    return studentId;
}

async function createStudentProfile(universityId: string, staffId: string, studentIdInput: string | number, email: string) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");

    const studentId = parseStudentId(studentIdInput);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid student email");
    const university = await University.findOne({ _id: universityId, status: "ACTIVE" });
    if (!university) throw new Error("Active university not found");
    return UniversityStudent.create({
        university: university._id,
        studentId,
        email: email.toLowerCase(),
        eligibilityStatus: "PENDING",
        financeStatus: "PENDING",
    });
}



module.exports = { createStudentProfile, parseStudentId };

if (require.main === module) {
    require("../cli/studentCli")
        .runCreateStudentCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
