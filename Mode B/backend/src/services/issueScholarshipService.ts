const { authorizeStaff } = require("./authorizeStaffService");
const { ScholarshipPool } = require("../models/ScholarshipPool");
const { StudentScholarship } = require("../models/StudentScholarship");
const { UniversityStudent } = require("../models/UniversityStudent");
const { getWeb3 } = require("../clients/blockchain/blockchainClient");
const { computeCommitment } = require("./generateStudentFile");
const { createStudentNote, uploadToIpfs } = require("../clients/ipfs/ipfsClient");

// Phải khớp MERKLE_DEPTH trong prover/src/flow_inputs.rs.
const MERKLE_DEPTH = 9;
const MAX_LEAVES = 1 << MERKLE_DEPTH;

// A23 — `rho` tuy chon: runner dinh tinh truyen tu dataset dinh luong.
async function issueScholarship(universityId: string, staffId: string, studentIdInput: string | number, rho?: string) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");

    const studentId = Number(studentIdInput);
    const student = await UniversityStudent.findOne({ university: universityId, studentId });
    if (!student) throw new Error("Approved student not found");
    if (student.eligibilityStatus !== "ELIGIBLE" || student.financeStatus !== "APPROVED" || !student.amountWei) {
        throw new Error("Student is not approved for scholarship");
    }
    const scholarship = await StudentScholarship.findOne({
        universityStudent: student._id,
        status: "WALLET_REGISTERED",
    });
    if (!scholarship) throw new Error("Registered scholarship not found");
    if (student.amountWei !== scholarship.amountWei) {
        throw new Error("Scholarship amount differs from Finance approval");
    }
    const pool = await ScholarshipPool.findOne({
        _id: scholarship.pool,
        university: universityId,
        status: "DEPLOYED",
    });
    if (!pool || !pool.contractAddress) throw new Error("Deployed scholarship pool not found");

    const balance = BigInt(await getWeb3().eth.getBalance(pool.contractAddress));
    const reservedRecords = await StudentScholarship.find({
        pool: pool._id,
        status: { $ne: "WITHDRAWN" },
    }).select("amountWei");
    const reserved = reservedRecords.reduce((sum: bigint, item: any) => sum + BigInt(item.amountWei), 0n);
    if (balance < reserved) throw new Error("Pool balance cannot cover approved scholarships");

    // Match advanced: reserve the next pool-scoped Merkle index before creating the note.
    const lastScholarship = await StudentScholarship.findOne({
        pool: pool._id,
        merkleIndex: { $exists: true, $ne: null },
    }).sort({ merkleIndex: -1 });
    const merkleIndex = lastScholarship ? Number(lastScholarship.merkleIndex) + 1 : 0;
    if (merkleIndex >= MAX_LEAVES) {
        throw new Error(`Merkle depth ${MERKLE_DEPTH} supports at most ${MAX_LEAVES} leaves`);
    }

    const note = createStudentNote(student.studentId, scholarship.amountWei, rho);
    const commitment = computeCommitment(note);
    const encryptedNoteCid = await uploadToIpfs(note, scholarship.publicKey);

    scholarship.encryptedNoteCid = encryptedNoteCid;
    scholarship.commitment = commitment;
    scholarship.merkleIndex = merkleIndex;
    scholarship.status = "NOTE_CREATED";
    await scholarship.save();
    return scholarship;
}



module.exports = { issueScholarship };

if (require.main === module) {
    require("../cli/issueScholarshipCli")
        .runIssueScholarshipCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
