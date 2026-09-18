const {
    createUniversity
} = require("../services/createUniversityService");
const {
    withDatabaseCleanup
} = require("./databaseController");

async function createUniversityController(
    name: string,
    walletAddress: string
) {
    if (!name || !walletAddress) {
        throw new Error(
            "University name and walletAddress are required"
        );
    }

    return withDatabaseCleanup(
        () => createUniversity(name, walletAddress)
    );
}

module.exports = {
    createUniversityController
};
