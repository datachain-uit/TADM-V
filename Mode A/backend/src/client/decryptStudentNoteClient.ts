// Compatibility entrypoint. Prefer src/cli/decryptStudentNoteCli.ts.
const {
    runDecryptStudentNoteCli,
    handleDecryptError
} = require("../cli/decryptStudentNoteCli");

module.exports = {
    runDecryptStudentNoteCli
};

if (require.main === module) {
    runDecryptStudentNoteCli().catch(handleDecryptError);
}
