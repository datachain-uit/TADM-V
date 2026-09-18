const {
    authorizeStaff
} = require("./authorizeStaffService");
const {
    universityIdOf
} = require("../utils/universityRef");

const {
    computeMerkleRoot
} = require(
    "./generateStudentFile"
);

const {
    connectDatabase,
    disconnectDatabase
} = require(
    "../config/database"
);

const {
    StudentScholarship
} = require(
    "../models/StudentScholarship"
);

const {
    normalizeBytes32
} = require(
    "../utils/bytes32"
);

const {
    resolveDeployedPool
} = require(
    "../repositories/scholarshipPoolRepository"
);

const {
    luuCayMerkle
} = require(
    "../repositories/merkleNodeRepository"
);

const {
    assertPoolUniversity,
    getShieldedPoolContract,
    resolveSender,
    withGasBuffer
} = require(
    "../clients/blockchain/shieldedPoolClient"
);

/**
 * Các trạng thái có commitment
 * phải tiếp tục nằm trong Merkle Tree.
 *
 * NOTE_CREATED:
 * commitment mới, đang chờ approve.
 *
 * Các trạng thái còn lại:
 * commitment đã thuộc một root trước đó,
 * không được xóa khỏi cây.
 */
const TREE_STATUSES = [
    "NOTE_CREATED",
    "ROOT_APPROVED",
    "WITHDRAWAL_REQUESTED",
    // "WITHDRAWAL_APPROVED",
    "WITHDRAWN"
];

async function approveRoot(
    poolId: string | undefined,
    staffId: string
) {
    // =========================
    // 1. CONNECT MONGODB
    // =========================

    await connectDatabase();

    // =========================
    // 2. GET POOL AND UNIVERSITY ACCOUNT
    // =========================

    const pool =
        await resolveDeployedPool(
            poolId
        );

    /*
     * K9 — cong bo cam ket cua danh sach thuoc Phong CTSV.
     * Kiem SAU khi co pool vi chi pool moi biet truong nao.
     */
    await authorizeStaff(
        universityIdOf(pool.university),
        staffId,
        "STUDENT_AFFAIRS"
    );

    await assertPoolUniversity(
        pool.contractAddress,
        pool.universityAddress,
        pool.chainId
    );

    const school =
        await resolveSender(
            pool.universityAddress,
            process.env.UNIVERSITY_PRIVATE_KEY
        );

    const contract =
        getShieldedPoolContract(
            pool.contractAddress
        );

    console.log(
        "School account:",
        school
    );

    console.log(
        "ShieldedPool contract:",
        pool.contractAddress
    );

    // =========================
    // 3. READ COMMITMENTS
    // FROM MONGODB
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 1 - READ COMMITMENTS FROM MONGODB"
    );

    console.log(
        "========================"
    );

    const scholarships =
        await StudentScholarship
            .find({
                pool:
                    pool._id,

                status: {
                    $in:
                        TREE_STATUSES
                },

                commitment: {
                    $exists:
                        true,

                    $ne:
                        null
                },

                merkleIndex: {
                    $exists:
                        true,

                    $ne:
                        null
                }
            })
            .sort({
                merkleIndex:
                    1
            })
            .lean();

    if (
        scholarships.length
        === 0
    ) {
        throw new Error(
            "No commitments found in MongoDB. " +
            "Issue at least one scholarship note first."
        );
    }

    // =========================
    // 4. VERIFY MERKLE INDEXES
    // =========================

    scholarships.forEach(
        (
            scholarship:
                any,

            expectedIndex:
                number
        ) => {
            const actualIndex =
                Number(
                    scholarship.merkleIndex
                );

            if (
                actualIndex
                !==
                expectedIndex
            ) {
                throw new Error(
                    "Merkle indexes are not continuous. " +
                    `Expected index ${expectedIndex}, ` +
                    `but received ${actualIndex}.`
                );
            }
        }
    );

    const commitments =
        scholarships.map(
            (
                scholarship:
                    any
            ) =>
                normalizeBytes32(
                    String(
                        scholarship.commitment
                    )
                )
        );

    console.log(
        "Commitment count:",
        commitments.length
    );

    commitments.forEach(
        (
            commitment:
                string,

            index:
                number
        ) => {
            console.log(
                `[${index}] ${commitment}`
            );
        }
    );

    // =========================
    // 5. COMPUTE CANDIDATE ROOT
    // NO PROOF IS CREATED
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 2 - COMPUTE MERKLE ROOT"
    );

    console.log(
        "NO PROOF IS CREATED"
    );

    console.log(
        "========================"
    );

    const rootData =
        await computeMerkleRoot(
            commitments
        );

    if (
        !rootData
        ||
        !rootData.root
    ) {
        throw new Error(
            "Rust root mode did not return a root"
        );
    }

    const candidateRoot =
        normalizeBytes32(
            String(
                rootData.root
            )
        );

    console.log(
        "Candidate root computed by Rust:",
        candidateRoot
    );

    // =========================
    // 6. READ CURRENT ROOT
    // FROM SMART CONTRACT
    // =========================

    const rootBefore =
        normalizeBytes32(
            String(
                await contract.methods
                    .currentRoot()
                    .call()
            )
        );

    console.log(
        "currentRoot before update:",
        rootBefore
    );

    // =========================
    // 7. UPDATE ROOT ON CHAIN
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 3 - UPDATE ROOT ON SMART CONTRACT"
    );

    console.log(
        "========================"
    );

    let transactionHash:
        string | undefined;

    /*
     * Gas thực tế của updateRoot.
     * Số liệu cho cột off-chain bảng gas §2.1.2.
     */
    let rootUpdateGasUsed:
        string | undefined;

    if (
        rootBefore
        ===
        candidateRoot
    ) {
        console.log(
            "Candidate root is already currentRoot."
        );

        console.log(
            "No new updateRoot transaction is required."
        );

    } else {
        /*
         * V4 — cong bo ca tap commitment cung luc voi root.
         *
         * Truyen THANG bien `commitments` da dung de tinh `candidateRoot`
         * o tren. KHONG duoc truy van MongoDB lan thu hai: hai lan doc co
         * the lech nhau neu co suat moi duoc cap xen vao, luc do root va
         * mang cong bo khong khop ma khong ai co y.
         */
        const method =
            contract.methods
                .updateRoot(
                    candidateRoot,
                    commitments
                );

        const estimatedGas =
            BigInt(
                await method
                    .estimateGas({
                        from:
                            school
                    })
            );

        const tx =
            await method.send({
                from:
                    school,

                gas:
                    withGasBuffer(
                        estimatedGas
                    )
            });

        transactionHash =
            String(
                tx.transactionHash
            );

        rootUpdateGasUsed =
            BigInt(
                tx.gasUsed
            ).toString();

        pool.lastRootUpdateGasUsed =
            rootUpdateGasUsed;

        /*
         * K10 — 03/09/2026: luu cay Merkle vua dung.
         *
         * Cay nay von DA duoc tinh o buoc tren (computeMerkleRoot)
         * roi bi vut di. Giu lai thi buoc rut chi con doc `depth`
         * nut thay vi chen lai n la — xem repositories/
         * merkleNodeRepository.ts.
         *
         * Ghi SAU khi giao dich doi root da thanh cong, de khong
         * luu cay cua mot root chua bao gio duoc duyet.
         *
         * `prover` doi bo sung `nodes`/`zeros` cung luc voi K10;
         * neu chay voi binary cu thi hai truong nay `undefined`,
         * luc do bo qua va buoc rut tu dong quay ve duong cu.
         */
        if (
            Array.isArray(
                rootData.nodes
            )
            &&
            Array.isArray(
                rootData.zeros
            )
        ) {
            const soNut =
                await luuCayMerkle(
                    pool._id,
                    rootData.nodes
                );

            pool.merkleZeros =
                rootData.zeros.map(
                    (
                        value:
                            string
                    ) =>
                        normalizeBytes32(
                            String(
                                value
                            )
                        )
                );

            pool.merkleDepth =
                rootData.nodes.length - 1;

            console.log(
                "Merkle nodes saved:",
                soNut,
                "| depth:",
                pool.merkleDepth
            );
        } else {
            console.log(
                "Prover did not return tree nodes"
                + " - withdrawal will rebuild the tree"
            );
        }

        await pool.save();

        console.log(
            "Root update tx:",
            transactionHash
        );

        console.log(
            "Root update gasUsed:",
            rootUpdateGasUsed
        );
    }

    // =========================
    // 8. READ ROOT BACK
    // FROM SMART CONTRACT
    // =========================

    const rootAfter =
        normalizeBytes32(
            String(
                await contract.methods
                    .currentRoot()
                    .call()
            )
        );

    const isValid =
        await contract.methods
            .validRoot(
                candidateRoot
            )
            .call();

    console.log(
        "currentRoot after update:",
        rootAfter
    );

    console.log(
        "validRoot[candidateRoot]:",
        isValid
    );

    if (
        rootAfter
        !==
        candidateRoot
    ) {
        throw new Error(
            "Root stored on smart contract does not " +
            "match the root computed from MongoDB commitments"
        );
    }

    if (!isValid) {
        throw new Error(
            "Candidate root was not added to validRoot history"
        );
    }

    // =========================
    // 9. UPDATE ONLY STATUS
    // DO NOT STORE ROOT IN MONGODB
    // =========================

    const updateResult =
        await StudentScholarship
            .updateMany(
                {
                    pool:
                        pool._id,

                    _id: {
                        $in:
                            scholarships
                                .filter(
                                    (
                                        scholarship:
                                            any
                                    ) =>
                                        scholarship.status
                                        ===
                                        "NOTE_CREATED"
                                )
                                .map(
                                    (
                                        scholarship:
                                            any
                                    ) =>
                                        scholarship._id
                                )
                    },

                    status:
                        "NOTE_CREATED"
                },
                {
                    $set: {
                        status:
                            "ROOT_APPROVED"
                    }
                }
            );

    console.log(
        "Newly approved commitments:",
        updateResult.modifiedCount
    );

    console.log(
        "\n========================"
    );

    console.log(
        "ROOT APPROVAL SUCCESS"
    );

    console.log(
        "========================"
    );

    console.log(
        "Approved root:",
        candidateRoot
    );

    if (transactionHash) {
        console.log(
            "Transaction hash:",
            transactionHash
        );
    }

    console.log(
        "Merkle root is stored only on the smart contract."
    );

    console.log(
        "MongoDB stores commitments and Merkle indexes only."
    );

    console.log(
        "PROOF HAS NOT BEEN CREATED YET."
    );

    return {
        pool,
        candidateRoot,
        transactionHash,
        rootUpdateGasUsed,
        currentRootAfter: rootAfter,
        validRoot: isValid
    };
}

module.exports = {
    approveRoot
};

if (require.main === module) {
    require("../cli/approveRootCli")
        .runApproveRootCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
