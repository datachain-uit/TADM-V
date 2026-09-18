const mongoose = require("mongoose");
const { Schema } = mongoose;

const StudentScholarshipSchema = new Schema({
    pool: { type: Schema.Types.ObjectId, ref: "OnchainScholarshipPool", required: true },
    universityStudent: { type: Schema.Types.ObjectId, ref: "OnchainUniversityStudent", required: true },
    walletAddress: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{40}$/ },
    publicKey: { type: String, required: true, trim: true },
    amountWei: { type: String, required: true, match: /^[1-9][0-9]*$/ },
    encryptedNoteCid: String,
    commitment: { type: String, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    merkleIndex: { type: Number, min: 0 },
    approvedRoot: { type: String, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    rootTransactionHash: String,
    withdrawTxHash: String,
    status: {
        type: String,
        enum: [
            "WALLET_REGISTERED",
            "NOTE_CREATED",
            "ROOT_APPROVED",
            "WITHDRAWAL_REQUESTED",
            "WITHDRAWN",
        ],
        default: "WALLET_REGISTERED",
        required: true,
    },
}, { timestamps: true, versionKey: false });

StudentScholarshipSchema.index({ pool: 1, universityStudent: 1 }, { unique: true });
/*
 * A21 — MOT VI CHI DUOC DUNG CHO DUNG MOT SUAT HOC BONG, VINH VIEN.
 * Dung lai vi o hai chuong trinh => quan sat vien giao hai tap ung vien
 * => tap an danh co lai (kenh "gop nhieu pool" cua FPR_UNL.1).
 * Chan VINH VIEN vi su kien tren chuoi la vinh cuu: pool A dong lai
 * khong lam `event Withdraw` cu bien mat.
 */
StudentScholarshipSchema.index({ walletAddress: 1 }, { unique: true });

// Giu index cu — bi bao ham, nhung bo di thi phai them buoc drop index.
StudentScholarshipSchema.index({ pool: 1, walletAddress: 1 }, { unique: true });
StudentScholarshipSchema.index(
    { encryptedNoteCid: 1 },
    { unique: true, partialFilterExpression: { encryptedNoteCid: { $type: "string" } } },
);
StudentScholarshipSchema.index(
    { commitment: 1 },
    { unique: true, partialFilterExpression: { commitment: { $type: "string" } } },
);
StudentScholarshipSchema.index(
    { pool: 1, merkleIndex: 1 },
    { unique: true, partialFilterExpression: { merkleIndex: { $type: "number" } } },
);

const StudentScholarship =
    mongoose.models.OnchainStudentScholarship
    || mongoose.model("OnchainStudentScholarship", StudentScholarshipSchema, "onchain_student_scholarships");
module.exports = { StudentScholarship };
