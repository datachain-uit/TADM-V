const {
    connectDatabase,
    disconnectDatabase
} = require("../config/database");

const {
    University
} = require("../models/University");

const {
    UniversityStudent
} = require("../models/UniversityStudent");

const {
    ScholarshipPool
} = require("../models/ScholarshipPool");

const {
    StudentScholarship
} = require("../models/StudentScholarship");

const {
    WithdrawalRequest
} = require("../models/WithdrawalRequest");

const {
    MerkleNode
} = require("../models/MerkleNode");

async function resetDatabase() {
    const connection = await connectDatabase();

    console.error(
        "RESETTING DATABASE:",
        connection.name
    );

    const withdrawalRequests =
        await WithdrawalRequest.deleteMany({});

    const studentScholarships =
        await StudentScholarship.deleteMany({});

    const scholarshipPools =
        await ScholarshipPool.deleteMany({});

    const universityStudents =
        await UniversityStudent.deleteMany({});

    const universities =
        await University.deleteMany({});

    /*
     * K10 — cay Merkle da luu. Khong xoa thi cac nut cu con lai
     * mo coi (khoa theo pool._id cu) va phinh dan qua moi lan reset.
     */
    const merkleNodes =
        await MerkleNode.deleteMany({});

    return {
        reset: true,
        storage: "MongoDB",
        database: connection.name,
        deletedDocuments: {
            withdrawalrequests: withdrawalRequests.deletedCount,
            studentscholarships: studentScholarships.deletedCount,
            scholarshippools: scholarshipPools.deletedCount,
            universitystudents: universityStudents.deletedCount,
            universities: universities.deletedCount,
            merklenodes: merkleNodes.deletedCount
        }
    };
}

module.exports = {
    resetDatabase
};

if (require.main === module) {
    resetDatabase()
        .then((result: any) => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch((error: any) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(disconnectDatabase);
}
