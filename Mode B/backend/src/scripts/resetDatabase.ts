const { connectDatabase, disconnectDatabase } = require("../config/database");
const { ScholarshipPool } = require("../models/ScholarshipPool");
const { StudentScholarship } = require("../models/StudentScholarship");
const { University } = require("../models/University");
const { UniversityStudent } = require("../models/UniversityStudent");
const { WithdrawalRequest } = require("../models/WithdrawalRequest");
const { MerkleNode } = require("../models/MerkleNode");
const { printJson } = require("../utils/serviceOutput");

async function resetDatabase() {
    const connection = await connectDatabase();
    const withdrawalRequests = await WithdrawalRequest.deleteMany({});
    const studentScholarships = await StudentScholarship.deleteMany({});
    const scholarshipPools = await ScholarshipPool.deleteMany({});
    const universityStudents = await UniversityStudent.deleteMany({});
    const universities = await University.deleteMany({});
    /*
     * K10 — cay Merkle da luu. Khong xoa thi cac nut cu con lai
     * mo coi (khoa theo pool._id cu) va phinh dan qua moi lan reset.
     */
    const merkleNodes = await MerkleNode.deleteMany({});
    return {
        reset: true,
        storage: "MongoDB",
        database: connection.name,
        deletedDocuments: {
            onchain_withdrawal_requests: withdrawalRequests.deletedCount,
            onchain_student_scholarships: studentScholarships.deletedCount,
            onchain_scholarship_pools: scholarshipPools.deletedCount,
            onchain_university_students: universityStudents.deletedCount,
            onchain_universities: universities.deletedCount,
            onchain_merkle_nodes: merkleNodes.deletedCount,
        },
    };
}

if (require.main === module) {
    resetDatabase()
        .then(printJson)
        .catch((error: Error) => {
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(disconnectDatabase);
}

module.exports = { resetDatabase };
