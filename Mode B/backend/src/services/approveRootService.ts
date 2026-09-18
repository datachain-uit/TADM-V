const { authorizeStaff } = require("./authorizeStaffService");
const { ScholarshipPool } = require("../models/ScholarshipPool");
const { StudentScholarship } = require("../models/StudentScholarship");
const { University } = require("../models/University");
const { getPool, requireUnlockedAccount, sameAddress } = require("../clients/blockchain/blockchainClient");
const { computeMerkleRoot, normalizeBytes32 } = require("./generateStudentFile");
const { luuCayMerkle } = require("../repositories/merkleNodeRepository");

async function approveRoot(poolId: string, staffId: string) {
    const pool = await ScholarshipPool.findById(poolId);
    if (!pool || pool.status !== "DEPLOYED" || !pool.contractAddress) throw new Error("Deployed pool not found");

    // K9 — cong bo cam ket cua danh sach thuoc Phong CTSV.
    await authorizeStaff(String(pool.university), staffId, "STUDENT_AFFAIRS");
    const university = await University.findById(pool.university);
    if (!university) throw new Error("University not found");
    const scholarships = await StudentScholarship.find({
        pool: pool._id,
        commitment: { $exists: true },
        status: { $in: ["NOTE_CREATED", "ROOT_APPROVED", "WITHDRAWAL_REQUESTED", "WITHDRAWN"] },
    }).sort({ merkleIndex: 1 });
    if (scholarships.length === 0) throw new Error("No scholarship commitment to approve");
    scholarships.forEach((item: any, index: number) => {
        if (item.merkleIndex !== index) throw new Error("Merkle indexes are not contiguous");
    });
    /*
     * V4 — giu lai mang commitment de cong bo cung luc voi root.
     * PHAI la dung mang da dung de tinh root (cung bien, cung thu tu),
     * khong duoc truy van MongoDB lan thu hai.
     */
    const commitments: string[] = scholarships.map((item: any) => item.commitment);
    const cayMerkle = computeMerkleRoot(commitments);
    const root = cayMerkle.root;
    /*
     * Vi KY GIAO DICH cua pool nay. `pool.operatorAddress` de trong thi
     * roi ve vi truong => hanh vi Y NHU TRUOC 2026-09-01.
     *
     * Cho phep MOI CHUONG TRINH mot vi rieng => chuoi nonce rieng => cac
     * chuong trinh cua cung mot truong khong phai cho nhau. Hop dong da
     * ho tro san (`school = msg.sender`, gan rieng tung pool); truoc day
     * backend cung hoa mot vi cho tat ca.
     */
    const schoolAddress =
        pool.operatorAddress || university.walletAddress;
    const school = await requireUnlockedAccount(schoolAddress);
    const contract = getPool(pool.contractAddress);
    if (!sameAddress(String(await contract.methods.school().call()), school)) {
        throw new Error("University is not the on-chain school");
    }
    const gas = Number(await contract.methods.updateRoot(root, commitments).estimateGas({ from: school }));
    const receipt = await contract.methods.updateRoot(root, commitments).send({ from: school, gas: Math.ceil(gas * 1.2) });
    const [currentRoot, validRoot] = await Promise.all([
        contract.methods.currentRoot().call(),
        contract.methods.validRoot(root).call(),
    ]);
    if (String(currentRoot).toLowerCase() !== root.toLowerCase() || validRoot !== true) {
        throw new Error("Root update was not persisted on-chain");
    }
    const approvedAt = new Date();
    pool.currentRoot = root;
    pool.rootHistory.push({ root, transactionHash: String(receipt.transactionHash), approvedAt });
    /*
     * K10 — 03/09/2026: luu cay Merkle vua dung.
     *
     * Cay nay von DA duoc tinh o `computeMerkleRoot` roi bi vut di.
     * Giu lai thi buoc rut chi con doc `depth` nut thay vi chen lai
     * n la — xem repositories/merkleNodeRepository.ts.
     *
     * Ghi SAU khi giao dich updateRoot da thanh cong, de khong luu cay
     * cua mot root chua bao gio duoc duyet.
     *
     * Prover cu khong tra ve `nodes`/`zeros` => bo qua, va buoc rut tu
     * dong quay ve duong cu.
     */
    if (Array.isArray(cayMerkle.nodes) && Array.isArray(cayMerkle.zeros)) {
        const soNut = await luuCayMerkle(pool._id, cayMerkle.nodes);
        pool.merkleZeros = cayMerkle.zeros.map((v: string) => normalizeBytes32(String(v)));
        pool.merkleDepth = cayMerkle.nodes.length - 1;
        console.error(`Merkle nodes saved: ${soNut} | depth: ${pool.merkleDepth}`);
    } else {
        console.error("Prover did not return tree nodes - withdrawal will rebuild the tree");
    }
    await pool.save();
    await StudentScholarship.updateMany(
        { pool: pool._id, status: "NOTE_CREATED" },
        {
            $set: {
                status: "ROOT_APPROVED",
                approvedRoot: root,
                rootTransactionHash: String(receipt.transactionHash),
            },
        },
    );
    return {
        poolId: pool.id,
        root,
        transactionHash: receipt.transactionHash,
        currentRoot: String(currentRoot),
        validRoot: Boolean(validRoot),
    };
}



module.exports = { approveRoot };

if (require.main === module) {
    require("../cli/approveRootCli")
        .runApproveRootCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
