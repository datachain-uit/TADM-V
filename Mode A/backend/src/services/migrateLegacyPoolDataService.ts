const {
    connectDatabase,
    disconnectDatabase
} = require(
    "../config/database"
);

const {
    UniversityStudent
} = require(
    "../models/UniversityStudent"
);

const {
    StudentScholarship
} = require(
    "../models/StudentScholarship"
);

const {
    WithdrawalRequest
} = require(
    "../models/WithdrawalRequest"
);

const {
    resolveDeployedPool
} = require(
    "../repositories/scholarshipPoolRepository"
);

async function getMigrationCounts() {
    return {
        universityStudentsWithoutUniversity:
            await UniversityStudent
                .countDocuments({
                    university: {
                        $exists: false
                    }
                }),

        scholarshipsWithoutPool:
            await StudentScholarship
                .countDocuments({
                    pool: {
                        $exists: false
                    }
                }),

        withdrawalRequestsWithoutPool:
            await WithdrawalRequest
                .countDocuments({
                    pool: {
                        $exists: false
                    }
                })
    };
}

async function migrateLegacyPoolData(
    poolId:
        string,

    apply:
        boolean
) {
    const pool =
        await resolveDeployedPool(
            poolId
        );

    const before =
        await getMigrationCounts();

    if (!apply) {
        return {
            mode:
                "DRY_RUN",
            pool,
            before
        };
    }

    await UniversityStudent
        .updateMany(
            {
                university: {
                    $exists: false
                }
            },
            {
                $set: {
                    university:
                        pool.university._id
                        ||
                        pool.university
                }
            }
        );

    await StudentScholarship
        .updateMany(
            {
                pool: {
                    $exists: false
                }
            },
            {
                $set: {
                    pool:
                        pool._id
                }
            }
        );

    await WithdrawalRequest
        .updateMany(
            {
                pool: {
                    $exists: false
                }
            },
            {
                $set: {
                    pool:
                        pool._id,
                    poolContractAddress:
                        pool.contractAddress,
                    poolChainId:
                        pool.chainId
                }
            }
        );

    await UniversityStudent
        .syncIndexes();
    await StudentScholarship
        .syncIndexes();
    await WithdrawalRequest
        .syncIndexes();

    return {
        mode:
            "APPLIED",
        pool,
        before,
        after:
            await getMigrationCounts()
    };
}

async function main() {
    const poolId =
        process.argv[2];

    const apply =
        process.argv[3]
        ===
        "--apply";

    if (!poolId) {
        throw new Error(
            "Usage: npx ts-node src/services/migrateLegacyPoolDataService.ts " +
            "<poolId> [--apply]"
        );
    }

    try {
        await connectDatabase();

        const result =
            await migrateLegacyPoolData(
                poolId,
                apply
            );

        console.log(
            JSON.stringify(
                {
                    mode:
                        result.mode,
                    poolId:
                        result.pool._id.toString(),
                    before:
                        result.before,
                    after:
                        result.after
                },
                null,
                2
            )
        );

        if (!apply) {
            console.log(
                "Dry run only. Re-run with --apply after backing up MongoDB."
            );
        }

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

module.exports = {
    getMigrationCounts,
    migrateLegacyPoolData
};
