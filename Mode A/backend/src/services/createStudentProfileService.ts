const {
    authorizeStaff
} = require("./authorizeStaffService");

const {
    UniversityStudent
} = require("../models/UniversityStudent");
const {
    University
} = require("../models/University");

async function createStudentProfile(
    universityId: string,
    staffId: string,
    studentId: number,
    email: string
) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");

    if (
        !universityId
        || !Number.isSafeInteger(studentId)
        || studentId <= 0
        || !email
    ) {
        throw new Error(
            "A universityId, positive studentId and email are required"
        );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const university = await University.findOne({
        _id: universityId,
        status: "ACTIVE"
    });

    if (!university) {
        throw new Error("Active university not found");
    }

    const existing = await UniversityStudent.findOne({
        $or: [
            { university: university._id, studentId },
            { university: university._id, email: normalizedEmail }
        ]
    });

    if (existing) {
        throw new Error("Student profile already exists");
    }

    const student = await UniversityStudent.create({
        university: university._id,
        studentId,
        email: normalizedEmail,
        eligibilityStatus: "PENDING",
        financeStatus: "PENDING"
    });

    console.log(
        "\n========================\n" +
        "UNIVERSITY STUDENT PROFILE CREATED\n" +
        "========================"
    );
    console.log("universityId:", university._id.toString());
    console.log("studentId:", student.studentId);
    console.log("email:", student.email);
    console.log(
        "eligibilityStatus:",
        student.eligibilityStatus
    );
    console.log("financeStatus:", student.financeStatus);

    return student;
}

module.exports = {
    createStudentProfile
};

if (require.main === module) {
    require("../cli/studentCli")
        .runCreateStudentProfileCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
