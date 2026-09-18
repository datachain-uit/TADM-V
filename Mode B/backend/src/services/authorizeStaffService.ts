const { UniversityStaff } = require("../models/UniversityStaff");

/*
 * Cong kiem vai tro dung chung cho ba buoc phe duyet.
 * Doi xung voi ADV (K6). Xem code/DECISIONS.md muc C5.
 *
 * ⚠️ Kiem o tang backend, KHONG phai ranh gioi tin cay mat ma.
 */
async function authorizeStaff(
    universityId: string,
    staffId: string,
    requiredRole: "STUDENT_AFFAIRS" | "FINANCE"
) {
    if (!universityId || !staffId) {
        throw new Error("A universityId and staffId are required");
    }

    const staff = await UniversityStaff.findOne({ university: universityId, staffId });
    if (!staff) throw new Error("Staff not found in this university: " + staffId);
    if (staff.status !== "ACTIVE") throw new Error("Staff account is not ACTIVE: " + staffId);
    if (staff.role !== requiredRole) {
        throw new Error(
            "Role mismatch: this step requires " + requiredRole
            + ", but staff " + staffId + " has role " + staff.role
        );
    }
    return staff;
}

const ROLE_LABEL: Record<string, string> = {
    STUDENT_AFFAIRS: "Phong Cong tac Sinh vien",
    FINANCE: "Phong Ke hoach - Tai chinh",
};


/*
 * Bien the KHONG rang buoc vai tro — dung cho createUniversityStaff.
 * Xem STATUS.md muc K9.
 */
async function authorizeAnyStaff(universityId: string, staffId: string) {
    if (!universityId || !staffId) {
        throw new Error("A universityId and staffId are required");
    }
    const staff = await UniversityStaff.findOne({ university: universityId, staffId });
    if (!staff) throw new Error("Staff not found in this university: " + staffId);
    if (staff.status !== "ACTIVE") throw new Error("Staff account is not ACTIVE: " + staffId);
    return staff;
}

module.exports = { authorizeStaff, authorizeAnyStaff, ROLE_LABEL };
