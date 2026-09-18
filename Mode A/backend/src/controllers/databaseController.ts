const {
    connectDatabase,
    disconnectDatabase
} = require("../config/database");

async function withDatabaseCleanup<T>(
    operation: () => Promise<T>
): Promise<T> {
    try {
        await connectDatabase();
        return await operation();
    } finally {
        await disconnectDatabase();
    }
}

module.exports = {
    withDatabaseCleanup
};
