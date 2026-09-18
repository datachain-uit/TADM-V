const {
    createStudentProfileController,
    approveEligibilityController,
    approveFinanceController,
    registerStudentWalletController
} = require("../controllers/studentController");
const {
    printJson
} = require("../utils/serviceOutput");

async function runCreateStudentCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentId, email] = args;

    if (!universityId || !staffId || !studentId || !email) {
        throw new Error(
            "Usage: npx ts-node src/cli/studentCli.ts create <universityId> <staffId> <studentId> <email>"
            + " | staffId phai co role STUDENT_AFFAIRS"
        );
    }

    printJson(
        await createStudentProfileController(
            universityId,
            staffId,
            studentId,
            email
        )
    );
}

async function runEligibilityCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentId, decision = "approve"] = args;

    if (!universityId || !staffId || !studentId) {
        throw new Error(
            "Usage: npx ts-node src/cli/studentCli.ts eligibility <universityId> <staffId> <studentId> [approve|reject]"
            + " | staffId phai co role STUDENT_AFFAIRS (Phong Cong tac Sinh vien)"
        );
    }

    printJson(
        await approveEligibilityController(
            universityId,
            staffId,
            studentId,
            decision
        )
    );
}

async function runFinanceCli(
    args: string[] = process.argv.slice(2)
) {
    const [universityId, staffId, studentId, amountWei] = args;

    if (!universityId || !staffId || !studentId || !amountWei) {
        throw new Error(
            "Usage: npx ts-node src/cli/studentCli.ts finance <universityId> <staffId> <studentId> <approvedAmountWei>"
            + " | staffId phai co role FINANCE (Phong Ke hoach - Tai chinh)"
        );
    }

    printJson(
        await approveFinanceController(
            universityId,
            staffId,
            studentId,
            amountWei
        )
    );
}

async function runWalletCli(
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
            "Usage: npx ts-node src/cli/studentCli.ts wallet <universityId>"
            + " <staffId> <poolId> <email> <wallet> <publicKey>"
            + " | staffId phai co role STUDENT_AFFAIRS"
            + " | poolId: mot truong co the co nhieu chuong trinh hoc bong,"
            + " phai noi ro dang ky vao chuong trinh nao"
        );
    }

    printJson(
        await registerStudentWalletController(
            universityId,
            poolId,
            email,
            walletAddress,
            publicKey,
            staffId
        )
    );
}

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
    create: runCreateStudentCli,
    eligibility: runEligibilityCli,
    finance: runFinanceCli,
    wallet: runWalletCli
};

async function runStudentCli(
    argv: string[] = process.argv.slice(2)
) {
    const [subcommand, ...rest] = argv;
    const handler = subcommand
        ? SUBCOMMANDS[subcommand]
        : undefined;

    if (!handler) {
        throw new Error(
            "Usage: npx ts-node src/cli/studentCli.ts <create|eligibility|finance|wallet> ..."
        );
    }

    await handler(rest);
}

module.exports = {
    runStudentCli,
    runCreateStudentCli,
    runEligibilityCli,
    runFinanceCli,
    runWalletCli
};

if (require.main === module) {
    runStudentCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
