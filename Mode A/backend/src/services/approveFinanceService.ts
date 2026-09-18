const {
    UniversityStudent
} = require("../models/UniversityStudent");

const {
    authorizeStaff,
    ROLE_LABEL
} = require("./authorizeStaffService");

/*
 * Bước 2 của quy trình duyệt — thuoc Phong Ke hoach - Tai chinh.
 * Van giu rang buoc thu tu: throw neu chua ELIGIBLE.
 */
async function approveFinance(
    universityId: string,
    staffId: string,
    studentId: number,
    amountWei: string
) {
    if (
        !universityId
        || !Number.isSafeInteger(studentId)
        || studentId <= 0
        || !/^[1-9][0-9]*$/.test(amountWei)
    ) {
        throw new Error(
            "A universityId, positive studentId and positive amountWei are required"
        );
    }

    const staff = await authorizeStaff(
        universityId,
        staffId,
        "FINANCE"
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

    if (student.eligibilityStatus !== "ELIGIBLE") {
        throw new Error(
            "Student must be ELIGIBLE before finance approval"
        );
    }

    student.amountWei = amountWei;
    student.financeStatus = "APPROVED";
    student.financeApprovedAt = new Date();
    await student.save();

    console.log(
        "\n========================\n" +
        "FINANCE APPROVAL COMPLETED\n" +
        "========================"
    );
    console.log("studentId:", student.studentId);
    console.log(
        "duyet boi:",
        staff.staffId,
        "-",
        ROLE_LABEL[staff.role]
    );
    console.log("approved amount:", student.amountWei, "wei");
    console.log("financeStatus:", student.financeStatus);

    return student;
}

module.exports = {
    approveFinance
};

if (require.main === module) {
    require("../cli/studentCli")
        .runApproveFinanceCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
