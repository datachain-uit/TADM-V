const {
    createUniversityStaffController,
    setStaffPasswordController,
    staffLoginController
} = require("../controllers/staffController");

async function runCreateUniversityStaffCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, actingStaffId, staffId, role] = args;

    if (
        !universityId
        || !actingStaffId
        || !staffId
        || (role !== "STUDENT_AFFAIRS" && role !== "FINANCE")
    ) {
        throw new Error(
            "Usage: staff:create <universityId> <actingStaffId> <staffId>"
            + " <STUDENT_AFFAIRS|FINANCE>"
            + "\n  actingStaffId = nhan su HIEN HUU dang bao lanh (bat ky role nao)"
            + "\n  STUDENT_AFFAIRS = Phong Cong tac Sinh vien"
            + "\n  FINANCE         = Phong Ke hoach - Tai chinh"
        );
    }

    return createUniversityStaffController(
        universityId,
        actingStaffId,
        staffId,
        role
    );
}


/*
 * K9b — hai lenh QUAN TRI. Chung KHONG thay doi 11 lenh nghiep vu:
 * cac lenh do van chi nhan `staffId` (ma dinh danh), vi CLI khong co
 * phien dang nhap. Xem STATUS.md muc K9b.
 */
async function runSetStaffPasswordCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, actingStaffId, staffId, password] = args;

    if (
        !universityId
        || !actingStaffId
        || !staffId
        || !password
    ) {
        throw new Error(
            "Usage: npm run staff:password -- <universityId> <actingStaffId> <staffId> <password>"
            + " | actingStaffId = nhan su HIEN HUU bao lanh"
            + " | password toi thieu 8 ky tu"
        );
    }

    return setStaffPasswordController(
        universityId,
        actingStaffId,
        staffId,
        password
    );
}

async function runStaffLoginCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, password] = args;

    if (
        !universityId
        || !staffId
        || !password
    ) {
        throw new Error(
            "Usage: npm run staff:login -- <universityId> <staffId> <password>"
        );
    }

    return staffLoginController(
        universityId,
        staffId,
        password
    );
}

module.exports = {
    runCreateUniversityStaffCli,
    runSetStaffPasswordCli,
    runStaffLoginCli
};

if (require.main === module) {
    runCreateUniversityStaffCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
