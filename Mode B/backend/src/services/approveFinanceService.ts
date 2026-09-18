const { UniversityStudent } = require("../models/UniversityStudent");

function validAmount(value: string) {
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error("approvedAmountWei must be a positive integer");
    return value;
}

const { authorizeStaff, ROLE_LABEL } = require("./authorizeStaffService");

/* Buoc 2 — thuoc Phong Ke hoach - Tai chinh (K6). Van giu rang buoc thu tu. */
async function approveFinance(universityId: string, staffId: string, studentIdInput: string | number, amountWei: string) {
    const staff = await authorizeStaff(universityId, staffId, "FINANCE");
    console.log("duyet boi:", staff.staffId, "-", ROLE_LABEL[staff.role]);
    validAmount(amountWei);
    const student = await UniversityStudent.findOne({
        university: universityId,
        studentId: Number(studentIdInput),
    });
    if (!student) throw new Error("Student not found");
    if (student.eligibilityStatus !== "ELIGIBLE") throw new Error("Student eligibility must be approved first");
    student.financeStatus = "APPROVED";
    student.amountWei = amountWei;
    student.financeApprovedAt = new Date();
    await student.save();
    return student;
}



module.exports = { approveFinance, validAmount };

if (require.main === module) {
    require("../cli/studentCli")
        .runFinanceCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
