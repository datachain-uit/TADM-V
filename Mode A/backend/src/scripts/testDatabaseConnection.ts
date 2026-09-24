const {
    connectDatabase,
    disconnectDatabase
} = require(
    "../config/database"
);

async function testDatabaseConnection() {
    try {
        console.log(
            "\n========================"
        );

        console.log(
            "MONGODB CONNECTION TEST"
        );

        console.log(
            "========================"
        );

        const connection =
            await connectDatabase();

        if (!connection.db) {
            throw new Error(
                "MongoDB database object is unavailable"
            );
        }

        console.log(
            JSON.stringify(
                {
                    database:
                        connection.db.databaseName,

                    host:
                        connection.host
                },
                null,
                2
            )
        );

        const pingResult =
            await connection.db
                .admin()
                .command({
                    ping:
                        1
                });

        console.log(
            "PING RESULT:",
            pingResult.ok
        );

        if (
            pingResult.ok
            !==
            1
        ) {
            throw new Error(
                "MongoDB ping failed"
            );
        }

        const collection =
            connection.db.collection(
                "connection_tests"
            );

        await collection.updateOne(
            {
                name:
                    "backend-connection-test"
            },
            {
                $set: {
                    name:
                        "backend-connection-test",

                    message:
                        "MongoDB connection works",

                    checkedAt:
                        new Date()
                }
            },
            {
                upsert:
                    true
            }
        );

        const document =
            await collection.findOne({
                name:
                    "backend-connection-test"
            });

        if (!document) {
            throw new Error(
                "Test document could not be read"
            );
        }

        console.log(
            "TEST DOCUMENT:"
        );

        console.log(
            JSON.stringify(
                document,
                null,
                2
            )
        );

        console.log(
            "\n========================"
        );

        console.log(
            "MONGODB TEST SUCCESS"
        );

        console.log(
            "========================"
        );

    } finally {
        await disconnectDatabase();
    }
}

if (
    require.main
    ===
    module
) {
    testDatabaseConnection()
        .catch(
            (
                error:
                    any
            ) => {
                console.error(
                    "\nMONGODB TEST FAILED"
                );

                console.error(
                    error
                );

                process.exitCode =
                    1;
            }
        );
}