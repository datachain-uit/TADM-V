const { authorizeStaff } = require("./authorizeStaffService");
const { ScholarshipPool } = require("../models/ScholarshipPool");
const { University } = require("../models/University");
const { UniversityStudent } = require("../models/UniversityStudent");

// Ten chuong trinh mac dinh — PHAI khop `default` cua model.
const DEFAULT_PROGRAM_NAME = "Hoc bong khuyen khich hoc tap";

async function createScholarshipPool(
    universityId: string,
    staffId: string,

    /*
     * Them 2026-08-29 (S-36): mot truong co NHIEU pool, moi pool la
     * mot chuong trinh hoc bong. Tham so dung CUOI va co mac dinh, nen
     * moi loi goi cu `createScholarshipPool(uni, staff)` van chay y het.
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
     * De trong => roi ve `university.walletAddress` => y nhu truoc.
     * Tham so dung CUOI va co mac dinh nen moi loi goi cu van chay y het.
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

    const university = await University.findOne({ _id: universityId, status: "ACTIVE" });
    if (!university) throw new Error("Active university not found");
    const approvedStudent = await UniversityStudent.exists({
        university: university._id,
        eligibilityStatus: "ELIGIBLE",
        financeStatus: "APPROVED",
    });
    if (!approvedStudent) throw new Error("No student has both eligibility and finance approval");

    const tenChuongTrinh = String(programName || "").trim();
    if (!tenChuongTrinh) throw new Error("programName must not be empty");

    /*
     * Chot chan ro rang, khong de mac index bao loi E11000 kho doc.
     * Chi chan pool DANG HOAT DONG CUNG TEN chuong trinh — hai chuong
     * trinh khac ten thi tao duoc ca hai. (Ban ADV cung logic nay.)
     */
    const existingPool = await ScholarshipPool.findOne({
        university: university._id,
        programName: tenChuongTrinh,
        status: { $in: ["PENDING_DEPLOYMENT", "DEPLOYING", "DEPLOYED"] },
    });
    if (existingPool) {
        throw new Error(
            "University already has an active scholarship pool for program: "
            + tenChuongTrinh
        );
    }

    return ScholarshipPool.create({
        university: university._id,
        universityAddress: university.walletAddress,

        /*
         * Vi VAN HANH rieng cua chuong trinh nay (them 2026-09-01).
         * Truyen vao thi moi chuong trinh mot chuoi nonce rieng => chay
         * song song duoc. De trong thi roi ve vi truong, y nhu cu.
         */
        operatorAddress: viVanHanh || undefined,
        programName: tenChuongTrinh,
        status: "PENDING_DEPLOYMENT",
        initialFundingWei: "0",
        totalSponsorFundingWei: "0",
        denominationWei: String(denominationWei || "0"),
    });
}



module.exports = { createScholarshipPool };

if (require.main === module) {
    require("../cli/poolCli")
        .runCreatePoolCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
