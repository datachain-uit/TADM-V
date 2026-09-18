const mongoose = require("mongoose");
const { Schema } = mongoose;

const RootHistorySchema = new Schema({
    root: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    transactionHash: { type: String, required: true, lowercase: true },
    approvedAt: { type: Date, required: true },
}, { _id: false });

const ScholarshipPoolSchema = new Schema({
    /*
     * MOT TRUONG CO NHIEU POOL — moi pool la MOT CHUONG TRINH hoc bong
     * (sua 2026-08-29, xem COWORK_SYNC.md S-36). Truoc day o day co
     * `unique: true`, tuc mot truong chi duoc MOT pool vinh vien — sai
     * voi bai toan that. Thay bang index ghep {university, programName}
     * o cuoi file.
     */
    university: { type: Schema.Types.ObjectId, ref: "OnchainUniversity", required: true },

    /*
     * Ten chuong trinh. CAN CO vi neu khong thi hai pool cua cung mot
     * truong khong phan biet duoc. Co `default` de document pool CU va
     * cac lenh CLI cu khong bi vo.
     */
    programName: {
        type: String,
        required: true,
        trim: true,
        default: "Hoc bong khuyen khich hoc tap",
    },
    universityAddress: {
        type: String,
        required: true,
        lowercase: true,
        match: /^0x[0-9a-f]{40}$/,
    },
    /*
     * VI VAN HANH RIENG CUA POOL NAY — them 2026-09-01.
     *
     * VI SAO CAN. `ShieldedPool` gan `school = msg.sender` LUC DEPLOY,
     * rieng tung pool. Nhung backend truoc day luon truyen CUNG MOT vi
     * (`university.walletAddress`) cho moi pool => moi pool cua mot truong
     * deu chung mot `school` => CHUNG MOT CHUOI NONCE => cac chuong trinh
     * hoc bong cua cung truong buoc phai chi tien TUAN TU.
     *
     * Do la han che CAU HINH, khong phai han che hop dong: hop dong da
     * cho phep moi pool mot `school` rieng ngay tu dau.
     *
     * De trong => roi ve `university.walletAddress` => hanh vi Y NHU CU.
     * Pool da tao truoc 2026-09-01 khong co truong nay van chay binh thuong.
     *
     * ⚠️ VAN LA MOT TRUONG. `university` van la chu so huu nghiep vu; day
     * chi la vi KY GIAO DICH cua chuong trinh do. Phan quyen van o backend
     * (`authorizeStaff`), hop dong KHONG doi mot dong => gas KHONG doi.
     */
    operatorAddress: {
        type: String,
        lowercase: true,
        match: /^0x[0-9a-f]{40}$/,
    },
    verifierAddress: { type: String, lowercase: true, match: /^0x[0-9a-f]{40}$/ },
    contractAddress: { type: String, lowercase: true, match: /^0x[0-9a-f]{40}$/ },
    chainId: { type: String, match: /^[0-9]+$/ },
    /*
     * V1(b) — menh gia co dinh cua pool (wei). "0" = KHONG cuong che.
     * Khac "0" thi hop dong chan moi luot rut co so tien khac => tap an
     * danh = kich thuoc pool tro thanh BAT BIEN.
     */
    denominationWei: { type: String, required: true, default: "0", match: /^[0-9]+$/ },
    initialFundingWei: { type: String, default: "0", match: /^[0-9]+$/ },
    totalSponsorFundingWei: { type: String, default: "0", match: /^[0-9]+$/ },
    currentRoot: { type: String, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    /*
     * K10 — goc cay con RONG cua tung tang, do prover tra ve cung luc
     * voi root. Can de suy sibling cua mot o TRONG, dung quy uoc trong
     * `get_path`. Dai dung depth + 1. Xem models/MerkleNode.ts.
     */
    merkleZeros: { type: [String], default: undefined },
    merkleDepth: { type: Number, min: 1 },
    rootHistory: { type: [RootHistorySchema], default: [] },
    status: {
        type: String,
        enum: ["PENDING_DEPLOYMENT", "DEPLOYING", "DEPLOYED", "DEPLOYMENT_FAILED"],
        default: "PENDING_DEPLOYMENT",
        required: true,
    },
    deploymentError: String,
    deployedAt: Date,
}, { timestamps: true, versionKey: false });

/*
 * Mot truong khong duoc co HAI pool CUNG TEN chuong trinh — thay cho
 * `unique: true` cu tren `university`.
 *
 * 🔴 BAY: bo `unique` trong schema KHONG xoa index da nam trong
 * MongoDB. Database nao da chay ban cu thi index cu van con va VAN
 * CHAN. `resetDatabase` dung `deleteMany({})` — xoa document, GIU
 * index. Phai xoa tay mot lan tren collection `onchain_scholarship_pools`:
 *
 *     db.onchain_scholarship_pools.dropIndex("university_1")
 *
 * Xem COWORK_SYNC.md S-36.
 */
ScholarshipPoolSchema.index(
    { university: 1, programName: 1 },
    { unique: true },
);

ScholarshipPoolSchema.index(
    { contractAddress: 1 },
    { unique: true, partialFilterExpression: { contractAddress: { $type: "string" } } },
);

const ScholarshipPool =
    mongoose.models.OnchainScholarshipPool
    || mongoose.model("OnchainScholarshipPool", ScholarshipPoolSchema, "onchain_scholarship_pools");
module.exports = { ScholarshipPool };
