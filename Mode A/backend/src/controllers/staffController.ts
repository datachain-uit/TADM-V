const {
    withDatabaseCleanup
} = require("./databaseController");

const {
    createUniversityStaff,
    seedDefaultStaff
} = require("../services/createUniversityStaffService");

const {
    setStaffPassword,
    staffLogin
} = require("../services/staffLoginService");

module.exports = {
    createUniversityStaffController: (
        universityId: string,
        actingStaffId: string,
        staffId: string,
        role: "STUDENT_AFFAIRS" | "FINANCE"
    ) => withDatabaseCleanup(
        () => createUniversityStaff(
            universityId,
            actingStaffId,
            staffId,
            role
        )
    ),

    // K9b — dat / doi mat khau. Phai co nhan su hien huu bao lanh.
    setStaffPasswordController: (
        universityId: string,
        actingStaffId: string,
        staffId: string,
        password: string
    ) => withDatabaseCleanup(
        () => setStaffPassword(
            universityId,
            actingStaffId,
            staffId,
            password
        )
    ),

    // K9b — dang nhap. Tang goi giu phien roi truyen `staffId` xuong.
    staffLoginController: (
        universityId: string,
        staffId: string,
        password: string
    ) => withDatabaseCleanup(
        () => staffLogin(
            universityId,
            staffId,
            password
        )
    ),

    // `seedDefaultStaff` la service nen KHONG tu mo ket noi.
    // Goi thang no tu runner se chet `MongoNotConnectedError`, vi
    // controller truoc do da dong ket noi trong `finally`.
    seedDefaultStaffController: (
        universityId: string
    ) => withDatabaseCleanup(
        () => seedDefaultStaff(universityId)
    )
};
