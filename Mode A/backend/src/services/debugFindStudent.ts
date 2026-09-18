const mongoose =
    require("mongoose");

const {
    connectDatabase,
    disconnectDatabase
} = require(
    "../config/database"
);

async function debugFindStudent() {
    const rawStudentId =
        process.argv[2];

    if (!rawStudentId) {
        throw new Error(
            "Usage: npx ts-node " +
            "src/services/debugFindStudent.ts " +
            "<studentId>"
        );
    }

    const numericStudentId =
        Number(
            rawStudentId
        );

    if (
        !Number.isSafeInteger(
            numericStudentId
        )
    ) {
        throw new Error(
            "studentId must be an integer"
        );
    }

    await connectDatabase();

    const database =
        mongoose.connection.db;

    if (!database) {
        throw new Error(
            "MongoDB database is unavailable"
        );
    }

    console.log(
        "\n========================"
    );

    console.log(
        "DATABASE INFORMATION"
    );

    console.log(
        "========================"
    );

    console.log(
        "Database name:",
        mongoose.connection.name
    );

    console.log(
        "MongoDB host:",
        mongoose.connection.host
    );

    const collections =
        await database
            .listCollections()
            .toArray();

    console.log(
        "\nCollections:"
    );

    collections.forEach(
        (
            collection:
                any
        ) => {
            console.log(
                "-",
                collection.name
            );
        }
    );

    console.log(
        "\n========================"
    );

    console.log(
        `SEARCHING STUDENT ${numericStudentId}`
    );

    console.log(
        "========================"
    );

    let foundCount =
        0;

    for (
        const collectionInfo
        of collections
    ) {
        const collection =
            database.collection(
                collectionInfo.name
            );

        const result =
            await collection.findOne({
                $or: [
                    {
                        studentId:
                            numericStudentId
                    },
                    {
                        studentId:
                            rawStudentId
                    },
                    {
                        student_id:
                            numericStudentId
                    },
                    {
                        student_id:
                            rawStudentId
                    }
                ]
            });

        if (result) {
            foundCount +=
                1;

            console.log(
                "\nFOUND IN COLLECTION:",
                collectionInfo.name
            );

            console.log(
                JSON.stringify(
                    result,
                    null,
                    2
                )
            );
        }
    }

    if (
        foundCount === 0
    ) {
        console.log(
            "\nSTUDENT NOT FOUND IN ANY COLLECTION"
        );

        console.log(
            "The data may be in another database, cluster, or environment."
        );
    }
}

async function main() {
    try {
        await debugFindStudent();

    } finally {
        await disconnectDatabase();
    }
}

if (
    require.main
    ===
    module
) {
    main().catch(
        (
            error:
                any
        ) => {
            console.error(
                error
            );

            process.exitCode =
                1;
        }
    );
}