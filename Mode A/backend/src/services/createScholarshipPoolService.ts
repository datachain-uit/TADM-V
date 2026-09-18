const {
    authorizeStaff
} = require("./authorizeStaffService");

const mongoose = require("mongoose");
const {
    University
} = require("../models/University");
const {
    ScholarshipPool
} = require("../models/ScholarshipPool");

// Ten chuong trinh mac dinh — PHAI khop `default` cua model, de goi
// ham nay khong truyen `programName` van ra dung mot ket qua.
const DEFAULT_PROGRAM_NAME = "Hoc bong khuyen khich hoc tap";

async function createScholarshipPool(
    universityId: string,
    staffId: string,

    /*
     * Them 2026-08-29 (S-36): mot truong co NHIEU pool, moi pool la
     * mot chuong trinh hoc bong. Tham so nay dung CUOI va co gia tri
     * mac dinh, nen moi loi goi cu `createScholarshipPool(uni, staff)`
     * van chay y nhu truoc.
     */
    programName: string = DEFAULT_PROGRAM_NAME,

    /*
     * Them 2026-09-01: vi VAN HANH rieng cua chuong trinh nay.
     *
     * `ShieldedPool` gan `school = msg.sender` LUC DEPLOY, rieng tung pool
     * — nen moi chuong trinh deploy bang mot vi khac nhau se co chuoi
     * nonce rieng => cac chuong trinh cua cung mot truong KHONG phai cho
     * nhau khi chi tien.
     *
     * Nhanh nay luu vi vao chinh `pool.universityAddress` (khac ONC, noi
     * cac service doc tu `university.walletAddress`), nen chi can dat dung
     * o day la moi buoc sau tu dung theo.
     *
     * De trong => roi ve `university.walletAddress` => y nhu truoc.
     */
    viVanHanh?: string,

    /*
     * V1(b) — MENH GIA CUONG CHE cua chuong trinh nay (them 2026-09-02).
     *
     * `RFC 6973 muc 3.3` doi tap an danh gom nhung ca the "have the same
     * attributes". Thuoc tinh quan sat vien thay tren chuoi la SO TIEN.
     * Neu moi nguoi mot muc thi tap an danh ve 1, va truoc thay doi nay
     * KHONG CO GI NGAN dieu do — `denominationWei` luon la "0", ma
     * `require(denomination == 0 || amount == denomination)` thi ve dau
     * dung nen luon qua.
     *
     * Truyen mot so > 0 vao day => hop dong TU CHOI moi lan nop sai muc.
     *
     * MAC DINH VAN LA "0" (khong cuong che) — co chu y, vi kich ban doi
     * chung cua C-13 can cap moi nguoi mot muc khac nhau de cho thay tap
     * an danh co lai. Bat cuong che o do la khong chay duoc kich ban do.
     */
    denominationWei: string = "0"
) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "FINANCE");

    if (!mongoose.Types.ObjectId.isValid(universityId)) {
        throw new Error("Invalid university id");
    }

    const university = await University.findOne({
        _id: universityId,
        status: "ACTIVE"
    });

    if (!university) {
        throw new Error("Active university not found");
    }

    const tenChuongTrinh = String(programName || "").trim();

    if (!tenChuongTrinh) {
        throw new Error("programName must not be empty");
    }

    /*
     * Chot chan HEP hon ban cu: truoc day chan "truong da co pool",
     * gio chi chan "truong da co pool DANG HOAT DONG CUNG TEN chuong
     * trinh nay". Hai chuong trinh khac ten thi tao duoc ca hai.
     */
    const existingPool = await ScholarshipPool.findOne({
        university: university._id,
        programName: tenChuongTrinh,
        status: {
            $in: [
                "PENDING_DEPLOYMENT",
                "DEPLOYING",
                "DEPLOYED"
            ]
        }
    });

    if (existingPool) {
        throw new Error(
            "University already has an active scholarship pool"
            + " for program: " + tenChuongTrinh
        );
    }

    return ScholarshipPool.create({
        university: university._id,
        universityAddress: viVanHanh || university.walletAddress,
        programName: tenChuongTrinh,
        status: "PENDING_DEPLOYMENT",
        denominationWei: String(denominationWei || "0")
    });
}

module.exports = {
    createScholarshipPool
};

if (require.main === module) {
    require("../cli/poolCli")
        .runCreatePoolCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
