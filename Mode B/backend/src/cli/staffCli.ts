const {
    createUniversityStaffController,
    setStaffPasswordController,
    staffLoginController
} = require("../controllers/staffController");
const {
    printJson
} = require("../utils/serviceOutput");

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
            "Usage: npx ts-node src/cli/staffCli.ts <universityId> <actingStaffId> <staffId> <STUDENT_AFFAIRS|FINANCE>"
            + " | actingStaffId = nhan su HIEN HUU dang bao lanh"
            + " | STUDENT_AFFAIRS = Phong Cong tac Sinh vien"
            + " | FINANCE = Phong Ke hoach - Tai chinh"
        );
    }

    printJson(
        await createUniversityStaffController(
            universityId,
            actingStaffId,
            staffId,
            role
        )
    );
}


/*
 * K9b — hai lenh QUAN TRI. KHONG thay doi 11 lenh nghiep vu:
 * cac lenh do van chi nhan `staffId`, vi CLI khong co phien dang nhap.
 * Xem STATUS.md muc K9b.
 */
async function runSetStaffPasswordCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, actingStaffId, staffId, password] = args;

    if (!universityId || !actingStaffId || !staffId || !password) {
        throw new Error(
            "Usage: npm run staff:password -- <universityId> <actingStaffId> <staffId> <password>"
            + " | actingStaffId = nhan su HIEN HUU bao lanh | password toi thieu 8 ky tu"
        );
    }

    printJson(
        await setStaffPasswordController(universityId, actingStaffId, staffId, password)
    );
}

async function runStaffLoginCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, password] = args;

    if (!universityId || !staffId || !password) {
        throw new Error(
            "Usage: npm run staff:login -- <universityId> <staffId> <password>"
        );
    }

    printJson(
        await staffLoginController(universityId, staffId, password)
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
