const fs = require("fs");
const {
    createWithdrawalRequestController
} = require("../controllers/withdrawalController");
const {
    printJson
} = require("../utils/serviceOutput");

/*
 * Nhận payload note qua STDIN, không qua argv — payload là JSON nhiều
 * trường (note đã giải mã, merkleIndex, danh sách commitment...), quá dài
 * cho tham số dòng lệnh.
 */
function readJsonFromStdin() {
    return JSON.parse(
        fs.readFileSync(0, "utf8")
    );
}

async function runCreateWithdrawalRequestCli() {
    printJson(
        await createWithdrawalRequestController(
            readJsonFromStdin()
        )
    );
}

module.exports = {
    runCreateWithdrawalRequestCli,
    readJsonFromStdin
};

if (require.main === module) {
    runCreateWithdrawalRequestCli()
        .catch(require("./cliErrorHandler").handleCliError);
}
