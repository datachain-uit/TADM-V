const mongoose = require("mongoose");

const { Schema } = mongoose;

/*
 * Nhan su cua mot truong, kem PHONG BAN.
 *
 * ⚠️ Kiem quyen o TANG BACKEND, KHONG phai ranh gioi tin cay
 * mat ma. Contract van chi co mot `school` duy nhat (onlySchool).
 * Bai bao duoc mo ta day la quy trinh hai buoc co rang buoc thu tu
 * va rang buoc vai tro, nhung KHONG duoc tuyen bo la tinh chat
 * bao mat. Xem code/DECISIONS.md muc C5.
 *
 * Doi xung voi zk-circuits-halo2-advanced (K6).
 */
const UniversityStaffSchema = new Schema({
    university: { type: Schema.Types.ObjectId, ref: "OnchainUniversity", required: true },
    staffId: { type: String, required: true, trim: true },
    role: { type: String, enum: ["STUDENT_AFFAIRS", "FINANCE"], required: true },
    // K9b — required:false CO CHU Y: seedDefaultStaff tao tai khoan khong mat khau,
    // bat buoc truong nay se lam vo hai runner. Xem STATUS.md muc K9b.
    passwordHash: { type: String, required: false },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", required: true },
}, { timestamps: true, versionKey: false });

// staffId chi can duy nhat TRONG mot truong.
UniversityStaffSchema.index({ university: 1, staffId: 1 }, { unique: true });

const UniversityStaff =
    mongoose.models.OnchainUniversityStaff
    || mongoose.model("OnchainUniversityStaff", UniversityStaffSchema, "onchain_university_staffs");
module.exports = { UniversityStaff };
