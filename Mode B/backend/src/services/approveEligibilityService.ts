const { UniversityStudent } = require("../models/UniversityStudent");

const { authorizeStaff, ROLE_LABEL } = require("./authorizeStaffService");

/* Buoc 1 — thuoc Phong Cong tac Sinh vien (K6). */
async function approveEligibility(universityId: string, staffId: string, studentIdInput: string | number, decision = "approve") {
    const staff = await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");
    console.log("duyet boi:", staff.staffId, "-", ROLE_LABEL[staff.role]);
    if (!["approve", "reject"].includes(decision)) throw new Error("Decision must be approve or reject");
    const student = await UniversityStudent.findOne({
        university: universityId,
        studentId: Number(studentIdInput),
    });
    if (!student) throw new Error("Student not found");
    student.eligibilityStatus = decision === "approve" ? "ELIGIBLE" : "REJECTED";
    student.eligibilityApprovedAt = new Date();
    if (decision === "reject") student.financeStatus = "REJECTED";
    await student.save();
    return student;
}



module.exports = { approveEligibility };

if (require.main === module) {
    require("../cli/studentCli")
        .runEligibilityCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
