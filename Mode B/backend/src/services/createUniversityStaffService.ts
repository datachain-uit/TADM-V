const { University } = require("../models/University");
const { UniversityStaff } = require("../models/UniversityStaff");
const { authorizeAnyStaff, ROLE_LABEL } = require("./authorizeStaffService");

/*
 * Tao mot nhan su thuoc mot phong ban cua truong. Doi xung voi ADV (K6).
 */
async function createUniversityStaff(
    universityId: string,
    actingStaffId: string,
    staffId: string,
    role: "STUDENT_AFFAIRS" | "FINANCE"
) {
    if (!universityId || !actingStaffId || !staffId || !["STUDENT_AFFAIRS", "FINANCE"].includes(role)) {
        throw new Error(
            "A universityId, staffId and role (STUDENT_AFFAIRS|FINANCE) are required"
        );
    }

    /*
     * K9 — BIT DUONG VONG: phai co mot nhan su hien huu con ACTIVE
     * bao lanh. Truoc day ham nay khong gac gi. Xem STATUS.md muc K9.
     */
    const actingStaff = await authorizeAnyStaff(universityId, actingStaffId);

    const university = await University.findById(universityId);
    if (!university) throw new Error("University not found");

    const existing = await UniversityStaff.findOne({ university: universityId, staffId });
    if (existing) throw new Error("Staff already exists in this university: " + staffId);

    const staff = await UniversityStaff.create({ university: universityId, staffId, role });

    console.log("UNIVERSITY STAFF CREATED");
    console.log("tao boi:", actingStaff.staffId, "-", ROLE_LABEL[actingStaff.role]);
    console.log("staffId:", staff.staffId);
    console.log("role:", staff.role, "-", ROLE_LABEL[staff.role]);
    return staff;
}

/*
 * Tien ich cho runner: dung san hai phong ban mac dinh.
 * Bo qua neu da ton tai, de chay lai khong vo.
 */
async function seedDefaultStaff(universityId: string) {
    const wanted: Array<["STUDENT_AFFAIRS" | "FINANCE", string]> = [
        ["STUDENT_AFFAIRS", "CTSV-01"],
        ["FINANCE", "KHTC-01"],
    ];

    const created: Record<string, string> = {};
    for (const [role, staffId] of wanted) {
        const existing = await UniversityStaff.findOne({ university: universityId, staffId });
        if (!existing) {
            await UniversityStaff.create({ university: universityId, staffId, role });
        }
        created[role] = staffId;
    }
    return created;
}

module.exports = { createUniversityStaff, seedDefaultStaff };

if (require.main === module) {
    require("../cli/staffCli")
        .runCreateUniversityStaffCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
