/*
 * CLI duyet THEO LO — thu tu chi tien do he thong xao tron.
 *
 * VI SAO CO FILE NAY. `reviewWithdrawalRequestCli` nhan DUNG MOT
 * `requestId`, nen no khong co khai niem thu tu de ma xao. Can bo mo
 * danh sach cho roi bam tu tren xuong => thu tu tren chuoi = thu tu nop
 * don => kenh tan cong 4 cua `anonymityExperiment.ts` mo toang.
 *
 * File nay dua ca lo vao mot lenh, va service tu xao truoc khi gui.
 *
 * Phan quyen KHONG doi: tung don van di qua `reviewWithdrawalRequest`,
 * van bat buoc `staffId` co role FINANCE.
 * Hop dong KHONG dung toi => gas KHONG doi.
 *
 * Chay:
 *   npx ts-node src/cli/reviewWithdrawalBatchCli.ts <staffId> <approve|reject> <id1> <id2> ...
 *
 * Hoac dua danh sach id qua STDIN (mot id moi dong):
 *   Get-Content ids.txt | npx ts-node src/cli/reviewWithdrawalBatchCli.ts <staffId> approve
 */
const {
    reviewWithdrawalBatchController
} = require("../controllers/withdrawalController");
const {
    printJson
} = require("../utils/serviceOutput");

function docStdin(): string[] {
    const fs = require("fs");

    try {
        // fd 0 = stdin. Neu khong co du lieu duong ong thi throw.
        return String(fs.readFileSync(0, "utf8"))
            .split(/\r?\n/)
            .map((d: string) => d.trim())
            .filter((d: string) => d.length > 0);
    } catch (error) {
        return [];
    }
}

async function runReviewWithdrawalBatchCli(
    args: string[] = process.argv.slice(2)
) {
    const [staffId, decision, ...idsTuArgv] = args;

    const requestIds =
        idsTuArgv.length > 0
            ? idsTuArgv
            : docStdin();

    if (!staffId || !decision || requestIds.length === 0) {
        throw new Error(
            "Usage: npx ts-node src/cli/reviewWithdrawalBatchCli.ts"
            + " <staffId> <approve|reject> <requestId...>"
            + "\n  hoac dua danh sach requestId qua STDIN, moi id mot dong."
            + "\n  staffId phai co role FINANCE (Phong Ke hoach - Tai chinh)."
        );
    }

    printJson(
        await reviewWithdrawalBatchController(
            requestIds,
            staffId,
            decision
        )
    );
}

module.exports = {
    runReviewWithdrawalBatchCli
};

if (require.main === module) {
    runReviewWithdrawalBatchCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
