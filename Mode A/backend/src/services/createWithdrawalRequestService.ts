const {
    computeNullifier,
    verifyProofOffChain,
    generateStudentFileFromNote
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
    normalizeBytes32,
    decimalToBytes32
} = require(
    "../utils/bytes32"
);

const {
    readJsonFromStdin
} = require(
    "../utils/readJsonStdin"
);

require(
    "../models/ScholarshipPool"
);

const {
    assertPoolUniversity,
    getShieldedPoolContract
} = require(
    "../clients/blockchain/shieldedPoolClient"
);

const {
    layDuongMerkle
} = require(
    "../repositories/merkleNodeRepository"
);

/*
 * Đây là các commitment đã thuộc
 * một Merkle root được nhà trường approve.
 *
 * Không lấy NOTE_CREATED vì commitment đó
 * chưa thuộc currentRoot trên smart contract.
 */
const APPROVED_TREE_STATUSES = [
    "ROOT_APPROVED",
    "WITHDRAWAL_REQUESTED",
    "WITHDRAWN"
];

function normalizeProof(
    value:
        any
): string {
    const proof =
        String(
            value
        );

    return proof.startsWith(
        "0x"
    )
        ?
        proof
        :
        "0x" + proof;
}

async function createWithdrawalRequest(
    submission:
        any
) {
    const cid =
        submission.cid;

    const note =
        submission.note;

    if (
        !cid
        ||
        !note
    ) {
        throw new Error(
            "Input must contain cid and note"
        );
    }

    if (
        note.student_id === undefined
        ||
        note.amount === undefined
        ||
        note.rho === undefined
    ) {
        throw new Error(
            "Decrypted note has invalid fields"
        );
    }

    await connectDatabase();

    const scholarship:
        any =
        await StudentScholarship
            .findOne({
                encryptedNoteCid:
                    cid
            })
            .populate(
                "universityStudent"
            )
            .populate(
                "pool"
            );

    if (!scholarship) {
        throw new Error(
            "Scholarship record not found"
        );
    }

    const pool =
        scholarship.pool;

    if (
        !pool
        ||
        pool.status
        !==
        "DEPLOYED"
    ) {
        throw new Error(
            "Scholarship is not assigned to a deployed pool"
        );
    }

    await assertPoolUniversity(
        pool.contractAddress,
        pool.universityAddress,
        pool.chainId
    );

    if (
        scholarship.status
        !==
        "ROOT_APPROVED"
    ) {
        throw new Error(
            "Scholarship status must be ROOT_APPROVED. " +
            `Current status: ${scholarship.status}`
        );
    }

    /*
     * Không cho tạo nhiều request đang hoạt động
     * cho cùng một học bổng.
     */
    const activeRequest =
        await WithdrawalRequest
            .findOne({
                scholarship:
                    scholarship._id,

                status: {
                    $in: [
                        "PENDING_APPROVAL",
                        "EXECUTION_FAILED"
                    ]
                }
            });

    if (activeRequest) {
        throw new Error(
            "An active withdrawal request already exists"
        );
    }

    const contract =
        getShieldedPoolContract(
            pool.contractAddress
        );

    /*
     * Root được đọc trực tiếp từ smart contract.
     * Không đọc root từ MongoDB.
     */
    const currentRoot =
        normalizeBytes32(
            String(
                await contract.methods
                    .currentRoot()
                    .call()
            )
        );

    const zeroRoot =
        "0x"
        +
        "00".repeat(
            32
        );

    if (
        currentRoot
        ===
        zeroRoot
    ) {
        throw new Error(
            "currentRoot is empty"
        );
    }

    const rootIsValid =
        await contract.methods
            .validRoot(
                currentRoot
            )
            .call();

    if (!rootIsValid) {
        throw new Error(
            "currentRoot is not approved"
        );
    }

    /*
     * Backend xây lại Merkle Tree từ các
     * commitment đã được approve.
     */
    const approvedScholarships =
        await StudentScholarship
            .find({
                pool:
                    pool._id,

                status: {
                    $in:
                        APPROVED_TREE_STATUSES
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
        approvedScholarships.length
        ===
        0
    ) {
        throw new Error(
            "No approved commitments found"
        );
    }

    approvedScholarships.forEach(
        (
            item:
                any,

            expectedIndex:
                number
        ) => {
            const actualIndex =
                Number(
                    item.merkleIndex
                );

            if (
                actualIndex
                !==
                expectedIndex
            ) {
                throw new Error(
                    "Approved Merkle indexes are not continuous. " +
                    `Expected ${expectedIndex}, ` +
                    `received ${actualIndex}`
                );
            }
        }
    );

    const commitments =
        approvedScholarships.map(
            (
                item:
                    any
            ) =>
                normalizeBytes32(
                    String(
                        item.commitment
                    )
                )
        );

    const merkleIndex =
        Number(
            scholarship.merkleIndex
        );

    const itemAtIndex =
        approvedScholarships[
            merkleIndex
        ];

    if (
        !itemAtIndex
        ||
        String(
            itemAtIndex._id
        )
        !==
        String(
            scholarship._id
        )
    ) {
        throw new Error(
            "Scholarship does not match its stored Merkle index"
        );
    }

    console.log(
        "\n========================"
    );

    console.log(
        "CREATE AND VERIFY PROOF"
    );

    console.log(
        "========================"
    );

    /*
     * Backend tự tính expected_nullifier từ rho
     * trong note đã giải mã. Giá trị này độc lập
     * với nullifier do mode prove trả về và được
     * dùng để đối chiếu chéo bên dưới.
     */
    const backendNullifier =
        computeNullifier(
            note
        );

    /*
     * Số tiền Phòng KH-TC đã duyệt. Tính sớm ở đây
     * vì nó là một trong ba public input nạp vào
     * bước verify ngay bên dưới.
     */
    const financeAmount =
        BigInt(
            scholarship
                .universityStudent
                .amountWei
        ).toString();

    /*
     * Rust tạo proof. Proof được trả về vô điều kiện —
     * quyền từ chối thuộc về bước verify ngay sau đó.
     */
    /*
     * K10 — 03/09/2026: doc duong Merkle da luu san.
     *
     * Co thi prover khong dung lai cay (O(depth) thay vi
     * O(n x depth)). Khong co — pool duyet root truoc K10,
     * hoac prover cu khong tra ve nodes — thi `layDuongMerkle`
     * tra ve null va ta giu nguyen duong cu bang commitments.
     * Khong bao loi: du lieu cu phai rut duoc.
     */
    const duongDaLuu =
        await layDuongMerkle(
            pool._id,
            merkleIndex,
            Number(pool.merkleDepth) || 0,
            (pool.merkleZeros as string[]) || []
        );

    console.log(
        "MERKLE PATH:",
        duongDaLuu
            ? "read " + duongDaLuu.siblings.length
                + " stored nodes"
            : "not stored - rebuilding from "
                + commitments.length + " commitments"
    );

    const proofData =
        generateStudentFileFromNote(
            note,
            currentRoot,
            commitments,
            merkleIndex,
            // A25 — ví nhận = ví sinh viên đã đăng ký; proof gắn với ví này.
            scholarship.walletAddress,
            duongDaLuu
        );

    if (
        !proofData
        ||
        !proofData.proof
        ||
        !proofData.root
        ||
        !proofData.nullifier
        ||
        proofData.amount === undefined
    ) {
        throw new Error(
            "Rust prover returned incomplete proof data"
        );
    }

    const proof =
        normalizeProof(
            proofData.proof
        );

    /*
     * ===== CỔNG CHẶN CHÍNH — chạy TRƯỚC mọi kiểm tra JS =====
     *
     * Ba public input nạp từ nguồn ĐỘC LẬP với prover:
     *   root      <- currentRoot đọc từ smart contract
     *   nullifier <- backend tự tính từ rho trong note
     *   amount    <- số Phòng KH-TC đã duyệt
     *   recipient <- ví sinh viên đã đăng ký (A25)
     *
     * Đặt ở đây, ngay sau khi có proof, để thứ từ chối một
     * note giả là RÀNG BUỘC MẬT MÃ, không phải một phép so
     * chuỗi trong JavaScript. Các kiểm tra JS bên dưới giữ
     * lại làm lớp dự phòng — nếu verify đã qua thì chúng
     * không bao giờ chạm tới.
     *
     * Xem code/VERIFY_MECHANISM.md và code/CONSTRAINT_FLOW.md.
     */
    let verification;

    try {
        verification =
            verifyProofOffChain(
                proof,
                currentRoot,
                backendNullifier,
                decimalToBytes32(
                    financeAmount
                ),
                scholarship.walletAddress
            );
    } catch (verifyError) {
        /*
         * Verify đã TỪ CHỐI — quyết định đã xong ở đây.
         *
         * Ba phép so bên dưới KHÔNG quyết định gì; chúng chỉ
         * giải thích số nào lệch. Cần thiết vì verify kiểm cả
         * ba public input bằng MỘT đẳng thức đa thức, nên chỉ
         * trả về đúng/sai chứ không tách được số nào sai.
         */
        const proofRoot =
            normalizeBytes32(
                String(proofData.root)
            );

        const proofNullifier =
            normalizeBytes32(
                String(proofData.nullifier)
            );

        const proofAmount =
            BigInt(
                proofData.amount
            ).toString();

        if (
            proofRoot
            !==
            normalizeBytes32(String(currentRoot))
        ) {
            throw new Error(
                "Proof rejected by Halo2 verifier: root does not match currentRoot on-chain"
            );
        }

        if (
            proofNullifier
            !==
            normalizeBytes32(String(backendNullifier))
        ) {
            throw new Error(
                "Proof rejected by Halo2 verifier: nullifier does not match the value computed by backend"
            );
        }

        if (
            proofAmount
            !==
            financeAmount
        ) {
            throw new Error(
                "Proof rejected by Halo2 verifier: amount does not match the Finance-approved amount"
            );
        }

        throw verifyError;
    }

    const expectedRoot =
        normalizeBytes32(
            String(
                proofData.root
            )
        );

    const expectedNullifier =
        normalizeBytes32(
            String(
                proofData.nullifier
            )
        );

    /*
     * Nullifier trong proof phải trùng với
     * nullifier backend tự tính từ rho.
     */
    if (
        expectedNullifier
        !==
        backendNullifier
    ) {
        throw new Error(
            "Proof nullifier does not match the nullifier computed by backend"
        );
    }

    const amountWei =
        BigInt(
            proofData.amount
        ).toString();

    if (
        expectedRoot
        !==
        currentRoot
    ) {
        throw new Error(
            "Proof root does not match currentRoot"
        );
    }

    if (
        BigInt(
            amountWei
        )
        <=
        0n
    ) {
        throw new Error(
            "Proof amount must be greater than zero"
        );
    }

    /*
     * Lớp dự phòng: verify ở trên đã ràng buộc amount trong
     * proof bằng financeAmount, nên nhánh này chỉ chạm tới
     * nếu có bug. Giữ lại để thông điệp lỗi rõ nghĩa.
     */
    if (
        amountWei
        !==
        financeAmount
    ) {
        throw new Error(
            "Proof amount does not match Finance-approved amount"
        );
    }

    const nullifierUsed =
        await contract.methods
            .usedNullifier(
                expectedNullifier
            )
            .call();

    if (nullifierUsed) {
        throw new Error(
            "This scholarship note has already been withdrawn"
        );
    }

    /*
     * Lưu proof package để khi University
     * approve, backend có thể chuyển tiền ngay.
     *
     * Không lưu:
     * student_id, rho, siblings, directions,
     * decrypted note hoặc private key.
     */
    const request =
        await WithdrawalRequest.create({
            pool:
                pool._id,

            poolContractAddress:
                pool.contractAddress,

            poolChainId:
                pool.chainId,

            scholarship:
                scholarship._id,

            proof,

            calldata:
                proofData.calldata
                ?
                String(
                    proofData.calldata
                )
                :
                undefined,

            expectedRoot,

            expectedNullifier,

            amountWei,

            recipient:
                scholarship.walletAddress,

            localVerificationPassed:
                verification.verified,

            /*
             * Số liệu cho bảng verification time
             * §2.1.1 (cột off-chain).
             */
            verificationMs:
                verification.verifyMs,

            verificationSetupMs:
                verification.setupMs,

            status:
                "PENDING_APPROVAL",

            proofPreparedAt:
                new Date()
        });

    scholarship.status =
        "WITHDRAWAL_REQUESTED";

    await scholarship.save();

    console.log(
        "\n========================"
    );

    console.log(
        "WITHDRAWAL REQUEST CREATED"
    );

    console.log(
        "========================"
    );

    console.log(
        "requestId:",
        request._id.toString()
    );

    console.log(
        "studentId:",
        scholarship
            .universityStudent
            .studentId
    );

    console.log(
        "amount:",
        request.amountWei,
        "wei"
    );

    console.log(
        "recipient:",
        request.recipient
    );

    console.log(
        "expectedRoot:",
        request.expectedRoot
    );

    console.log(
        "expectedNullifier:",
        request.expectedNullifier
    );

    console.log(
        "status:",
        request.status
    );

    console.log(
        "No blockchain transfer has occurred"
    );

    return request;
}

module.exports = {
    createWithdrawalRequest
};

if (require.main === module) {
    require("../cli/createWithdrawalRequestCli")
        .runCreateWithdrawalRequestCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
