const { University } = require("../models/University");
const { getWeb3 } = require("../clients/blockchain/blockchainClient");
const { seedDefaultStaff } = require("./createUniversityStaffService");

async function createUniversity(name: string, walletAddress: string) {
    if (!name.trim()) throw new Error("University name is required");
    if (!getWeb3().utils.isAddress(walletAddress)) throw new Error("Invalid university wallet");
    const university = await University.create({
        name: name.trim(),
        walletAddress: walletAddress.toLowerCase(),
        status: "ACTIVE",
    });

    /*
     * K9 — GIA DINH TIN CAY LUC KHOI TAO. Doi xung voi ADV.
     *
     * Dung san `CTSV-01` + `KHTC-01`. Neu khong lam o day thi khong
     * the tao nhan su dau tien: `createUniversityStaff` doi phai co
     * MOT nhan su hien huu bao lanh (K9a), va `seedDefaultStaff` CO
     * CHU Y khong co loi vao CLI rieng.
     *
     * Xem STATUS.md muc K9 va DECISIONS.md muc C5.
     */
    await seedDefaultStaff(String(university._id));

    return university;
}



module.exports = { createUniversity };

if (require.main === module) {
    require("../cli/createUniversityCli")
        .runCreateUniversityCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
