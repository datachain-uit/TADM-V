const {
    UniversityStudent
} = require("../models/UniversityStudent");

const {
    authorizeStaff,
    ROLE_LABEL
} = require("./authorizeStaffService");

/*
 * Bước 1 của quy trình duyệt — thuộc Phong Cong tac Sinh vien.
 * `staffId` bắt buộc: xem code/DECISIONS.md muc C5.
 */
async function approveEligibility(
    universityId: string,
    staffId: string,
    studentId: number,
    decision: "approve" | "reject"
) {
    if (
        !universityId
        || !Number.isSafeInteger(studentId)
        || studentId <= 0
        || !["approve", "reject"].includes(decision)
    ) {
        throw new Error(
            "A universityId, positive studentId and approve|reject decision are required"
        );
    }

    const staff = await authorizeStaff(
        universityId,
        staffId,
        "STUDENT_AFFAIRS"
    );

    const student = await UniversityStudent.findOne({
        university: universityId,
        studentId
    });

    if (!student) {
        throw new Error(
            "University student profile not found"
        );
    }

    if (decision === "approve") {
        student.eligibilityStatus = "ELIGIBLE";
        student.eligibilityApprovedAt = new Date();
    } else {
        student.eligibilityStatus = "REJECTED";
        student.financeStatus = "REJECTED";
        student.amountWei = undefined;
    }

    await student.save();
    console.log(
        "\n========================\n" +
        "ELIGIBILITY REVIEW COMPLETED\n" +
        "========================"
    );
    console.log(
        "duyet boi:",
        staff.staffId,
        "-",
        ROLE_LABEL[staff.role]
    );
    console.log("studentId:", student.studentId);
    console.log(
        "eligibilityStatus:",
        student.eligibilityStatus
    );

    return student;
}

module.exports = {
    approveEligibility
};

if (require.main === module) {
    require("../cli/studentCli")
        .runApproveEligibilityCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
