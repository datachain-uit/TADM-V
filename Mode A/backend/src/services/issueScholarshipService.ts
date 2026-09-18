const {
    authorizeStaff
} = require("./authorizeStaffService");

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

require(
    "../models/ScholarshipPool"
);

const {
    createEncryptedNote
} = require(
    "./generateStudentFile"
);

// Phải khớp MERKLE_DEPTH trong prover/src/inputs_builder.rs.
// depth = 9 nên tối đa 2^9 = 512 leaf mỗi pool.
const MERKLE_DEPTH =
    9;

const MAX_LEAVES =
    1 << MERKLE_DEPTH;

async function issueScholarship(
    universityId: string,
    staffId: string,
    studentId: number,

    // A23 — `rho` co san tu dataset dinh luong (tuy chon).
    rho?: string
) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");

    if (
        !universityId
        ||
        !Number.isSafeInteger(
            studentId
        )
        ||
        studentId <= 0
    ) {
        throw new Error(
            "A valid universityId and positive studentId are required"
        );
    }

    await connectDatabase();

    // =========================
    // 1. FIND UNIVERSITY PROFILE
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 1 - FIND UNIVERSITY STUDENT"
    );

    console.log(
        "========================"
    );

    console.log(
        "Input studentId:",
        studentId
    );

    console.log(
        "UniversityStudent collection:",
        UniversityStudent
            .collection
            .name
    );

    const universityStudent =
        await UniversityStudent
            .findOne({
                university:
                    universityId,

                studentId
            });

    if (!universityStudent) {
        throw new Error(
            "University student profile does not exist"
        );
    }

    console.log(
        "University student found:",
        universityStudent.studentId
    );

    // =========================
    // 2. CHECK STUDENT AFFAIRS
    // =========================

    if (
        universityStudent
            .eligibilityStatus
        !==
        "ELIGIBLE"
    ) {
        throw new Error(
            "Student has not been approved " +
            "by Student Affairs. " +
            `Current eligibilityStatus: ${universityStudent.eligibilityStatus}`
        );
    }

    console.log(
        "eligibilityStatus:",
        universityStudent
            .eligibilityStatus
    );

    // =========================
    // 3. CHECK FINANCE APPROVAL
    // =========================

    if (
        universityStudent
            .financeStatus
        !==
        "APPROVED"
    ) {
        throw new Error(
            "Scholarship amount has not been " +
            "approved by Finance. " +
            `Current financeStatus: ${universityStudent.financeStatus}`
        );
    }

    if (
        !universityStudent
            .amountWei
    ) {
        throw new Error(
            "Finance-approved amountWei is missing"
        );
    }

    console.log(
        "financeStatus:",
        universityStudent.financeStatus
    );

    console.log(
        "approved amount:",
        universityStudent.amountWei,
        "wei"
    );

    // =========================
    // 4. FIND WALLET RECORD
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 2 - FIND STUDENT WALLET"
    );

    console.log(
        "========================"
    );

    const student =
        await StudentScholarship
            .findOne({
                universityStudent:
                    universityStudent._id
            })
            .populate(
                "pool"
            );

    if (!student) {
        throw new Error(
            "Student has not registered wallet and public key"
        );
    }

    if (
        !student.pool
        ||
        student.pool.status
        !==
        "DEPLOYED"
    ) {
        throw new Error(
            "Student scholarship is not assigned to a deployed pool"
        );
    }

    console.log(
        "StudentScholarship found:",
        student._id.toString()
    );

    console.log(
        "walletAddress:",
        student.walletAddress
    );

    if (!student.publicKey) {
        throw new Error(
            "Student public key is missing"
        );
    }

    if (
        student.status
        !==
        "WALLET_REGISTERED"
    ) {
        throw new Error(
            "Student scholarship status must be " +
            "WALLET_REGISTERED before issuing note. " +
            `Current status: ${student.status}`
        );
    }

    if (
        student.commitment
        ||
        student.encryptedNoteCid
    ) {
        throw new Error(
            "Scholarship note has already been issued"
        );
    }

    // =========================
    // 5. DETERMINE MERKLE INDEX
    // =========================

    const lastStudent =
        await StudentScholarship
            .findOne({
                pool:
                    student.pool._id,

                merkleIndex: {
                    $exists:
                        true,

                    $ne:
                        null
                }
            })
            .sort({
                merkleIndex:
                    -1
            });

    const nextIndex =
        lastStudent
            ?
            Number(
                lastStudent
                    .merkleIndex
            )
            +
            1
            :
            0;

    if (
        nextIndex
        >=
        MAX_LEAVES
    ) {
        throw new Error(
            `Current Merkle depth is ${MERKLE_DEPTH}, ` +
            `so only ${MAX_LEAVES} leaves are supported`
        );
    }

    console.log(
        "Assigned Merkle index:",
        nextIndex
    );

    // =========================
    // 6. CREATE NOTE
    // ENCRYPT AND UPLOAD IPFS
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 3 - CREATE ENCRYPTED NOTE"
    );

    console.log(
        "========================"
    );

    const noteResult =
        await createEncryptedNote(
            universityStudent.studentId,
            universityStudent.amountWei,
            student.publicKey,
            rho
        );

    if (
        !noteResult
        ||
        !noteResult.cid
        ||
        !noteResult.commitment
    ) {
        throw new Error(
            "createEncryptedNote did not return CID and commitment"
        );
    }

    // =========================
    // 7. SAVE ZKP SUPPORT DATA
    // =========================

    student.encryptedNoteCid =
        noteResult.cid;

    student.commitment =
        noteResult.commitment;

    student.merkleIndex =
        nextIndex;

    student.status =
        "NOTE_CREATED";

    await student.save();

    console.log(
        "\n========================"
    );

    console.log(
        "SCHOLARSHIP NOTE ISSUED"
    );

    console.log(
        "========================"
    );

    console.log(
        "studentId:",
        universityStudent.studentId
    );

    console.log(
        "approved amount:",
        universityStudent.amountWei,
        "wei"
    );

    console.log(
        "CID:",
        student.encryptedNoteCid
    );

    console.log(
        "commitment:",
        student.commitment
    );

    console.log(
        "merkleIndex:",
        student.merkleIndex
    );

    console.log(
        "status:",
        student.status
    );

    console.log(
        "Nullifier was not stored in MongoDB"
    );

    console.log(
        "Merkle root was not stored in MongoDB"
    );

    return student;
}

module.exports = {
    issueScholarship
};

if (require.main === module) {
    require("../cli/issueScholarshipCli")
        .runIssueScholarshipCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
