const {
    withDatabaseCleanup
} = require("./databaseController");
const {
    createUniversityStaff
} = require("../services/createUniversityStaffService");
const {
    setStaffPassword,
    staffLogin
} = require("../services/staffLoginService");

async function createUniversityStaffController(
    universityId: string,
    actingStaffId: string,
    staffId: string,
    role: "STUDENT_AFFAIRS" | "FINANCE"
) {
    if (!universityId || !actingStaffId || !staffId || !role) {
        throw new Error(
            "universityId, actingStaffId, staffId and role are required"
        );
    }

    return withDatabaseCleanup(
        () => createUniversityStaff(universityId, actingStaffId, staffId, role)
    );
}

// K9b — dat / doi mat khau. Phai co nhan su hien huu bao lanh.
async function setStaffPasswordController(
    universityId: string,
    actingStaffId: string,
    staffId: string,
    password: string
) {
    return withDatabaseCleanup(
        () => setStaffPassword(universityId, actingStaffId, staffId, password)
    );
}

// K9b — dang nhap. Tang goi giu phien roi truyen `staffId` xuong.
async function staffLoginController(
    universityId: string,
    staffId: string,
    password: string
) {
    return withDatabaseCleanup(
        () => staffLogin(universityId, staffId, password)
    );
}

module.exports = {
    createUniversityStaffController,
    setStaffPasswordController,
    staffLoginController
};
