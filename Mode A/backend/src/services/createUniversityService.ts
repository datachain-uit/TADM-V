const {
    University
} = require("../models/University");
const {
    normalizeAddress
} = require("../clients/blockchain/shieldedPoolClient");
const {
    seedDefaultStaff
} = require("./createUniversityStaffService");

async function createUniversity(
    name: string,
    walletAddress: string
) {
    const normalizedName = String(name).trim();

    if (!normalizedName) {
        throw new Error("University name is required");
    }

    const normalizedWallet = normalizeAddress(walletAddress);
    const existing = await University.findOne({
        $or: [
            { name: normalizedName },
            { walletAddress: normalizedWallet }
        ]
    });

    if (existing) {
        throw new Error(
            "University name or wallet address already exists"
        );
    }

    const university = await University.create({
        name: normalizedName,
        walletAddress: normalizedWallet,
        status: "ACTIVE"
    });

    /*
     * K9 — GIA DINH TIN CAY LUC KHOI TAO.
     *
     * Moi truong duoc dung san hai tai khoan phong ban `CTSV-01`
     * (Phong Cong tac Sinh vien) va `KHTC-01` (Phong Ke hoach -
     * Tai chinh). Neu khong lam o day thi khong the tao nhan su
     * dau tien: `createUniversityStaff` doi phai co MOT nhan su
     * hien huu bao lanh (K9a), va `seedDefaultStaff` CO CHU Y
     * khong co loi vao CLI rieng — lo ra CLI la dung lai chinh
     * duong vong vua bit.
     *
     * Xem STATUS.md muc K9 va DECISIONS.md muc C5. Bai bao phai
     * ghi thang day la gia dinh tin cay luc khoi tao.
     */
    await seedDefaultStaff(String(university._id));

    return university;
}

module.exports = {
    createUniversity
};

if (require.main === module) {
    require("../cli/createUniversityCli")
        .runCreateUniversityCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
