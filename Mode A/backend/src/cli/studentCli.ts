const {
    createStudentProfileController,
    approveEligibilityController,
    approveFinanceController,
    registerStudentWalletController
} = require("../controllers/studentController");

async function runCreateStudentProfileCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentIdRaw, email] = args;
    if (!universityId || !staffId || !studentIdRaw || !email) {
        throw new Error(
            "Usage: student:create <universityId> <staffId> <studentId> <email>"
            + " | staffId phai co role STUDENT_AFFAIRS"
        );
    }
    return createStudentProfileController(
        universityId,
        staffId,
        Number(studentIdRaw),
        email
    );
}

async function runApproveEligibilityCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentIdRaw, decision] = args;
    if (
        !universityId
        || !staffId
        || !studentIdRaw
        || (decision !== "approve" && decision !== "reject")
    ) {
        throw new Error(
            "Usage: student:eligibility <universityId> <staffId> <studentId> <approve|reject>"
            + " | staffId phai co role STUDENT_AFFAIRS (Phong Cong tac Sinh vien)"
        );
    }
    return approveEligibilityController(
        universityId,
        staffId,
        Number(studentIdRaw),
        decision
    );
}

async function runApproveFinanceCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentIdRaw, amountWei] = args;
    if (!universityId || !staffId || !studentIdRaw || !amountWei) {
        throw new Error(
            "Usage: student:finance <universityId> <staffId> <studentId> <amountWei>"
            + " | staffId phai co role FINANCE (Phong Ke hoach - Tai chinh)"
        );
    }
    return approveFinanceController(
        universityId,
        staffId,
        Number(studentIdRaw),
        amountWei
    );
}

async function runRegisterStudentWalletCli(
    args: string[] = process.argv.slice(2)
) {
    // A22 — them `poolId`, dat ngay sau `staffId`. BAT BUOC.
    const [
        universityId,
        staffId,
        poolId,
        email,
        walletAddress,
        publicKey
    ] = args;

    if (
        !universityId || !staffId || !poolId
        || !email || !walletAddress || !publicKey
    ) {
        throw new Error(
            "Usage: student:wallet <universityId> <staffId> <poolId>"
            + " <email> <walletAddress> <publicKey>"
            + " | staffId phai co role STUDENT_AFFAIRS"
            + " | poolId: mot truong co the co nhieu chuong trinh hoc bong,"
            + " phai noi ro dang ky vao chuong trinh nao"
        );
    }

    return registerStudentWalletController(
        universityId,
        staffId,
        poolId,
        email,
        walletAddress,
        publicKey
    );
}

module.exports = {
    runCreateStudentProfileCli,
    runApproveEligibilityCli,
    runApproveFinanceCli,
    runRegisterStudentWalletCli
};

if (require.main === module) {
    const [action, ...args] = process.argv.slice(2);
    const commands: Record<string, (values: string[]) => Promise<any>> = {
        create: runCreateStudentProfileCli,
        eligibility: runApproveEligibilityCli,
        finance: runApproveFinanceCli,
        wallet: runRegisterStudentWalletCli
    };
    const command = action ? commands[action] : undefined;

    if (!command) {
        console.error(
            "Usage: npx ts-node src/cli/studentCli.ts <create|eligibility|finance|wallet> ..."
        );
        process.exitCode = 1;
    } else {
        command(args).catch((error: any) => {
            console.error(error);
            process.exitCode = 1;
        });
    }
}
