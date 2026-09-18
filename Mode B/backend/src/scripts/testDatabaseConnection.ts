const { connectDatabase, disconnectDatabase } = require("../config/database");

async function testDatabaseConnection() {
    try {
        const connection = await connectDatabase();
        if (!connection.db) throw new Error("MongoDB database object is unavailable");
        const result = await connection.db.admin().command({ ping: 1 });
        if (result.ok !== 1) throw new Error("MongoDB ping failed");
        return { success: true, database: connection.name, host: connection.host, ping: result.ok };
    } finally {
        await disconnectDatabase();
    }
}

if (require.main === module) {
    testDatabaseConnection()
        .then((result: unknown) => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
        .catch((error: Error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}

module.exports = { testDatabaseConnection };
