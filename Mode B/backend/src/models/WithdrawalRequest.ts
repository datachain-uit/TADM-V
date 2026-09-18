const mongoose = require("mongoose");
const { Schema } = mongoose;

const WithdrawalRequestSchema = new Schema({
    pool: { type: Schema.Types.ObjectId, ref: "OnchainScholarshipPool", required: true },
    scholarship: { type: Schema.Types.ObjectId, ref: "OnchainStudentScholarship", required: true },
    poolContractAddress: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{40}$/ },
    poolChainId: { type: String, required: true, match: /^[0-9]+$/ },
    proof: { type: String, required: true },
    calldata: { type: String, required: true },
    expectedRoot: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    expectedNullifier: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    amountWei: { type: String, required: true, match: /^[1-9][0-9]*$/ },
    recipient: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{40}$/ },
    localVerificationPassed: { type: Boolean, required: true, default: false },
    status: {
        type: String,
        enum: ["PENDING_APPROVAL", "REJECTED", "EXECUTED", "EXECUTION_FAILED"],
        default: "PENDING_APPROVAL",
        required: true,
    },
    proofPreparedAt: { type: Date, required: true },
    reviewedAt: Date,
    transactionHash: String,
    failureReason: String,
    gasLimit: Number,

    /*
     * GIAI DOAN 1 — xac minh va ghi nhan len chuoi (them 2026-08-25).
     *
     * `verifyRecordTxHash` la BANG CHUNG TREN CHUOI rang proof da duoc
     * hop dong tu verify. Truoc day buoc nay la `eth.call` — mien phi
     * nhung khong de lai dau vet, nen khong ai kiem lai duoc.
     *
     * `verifyRecordGas` phuc vu do luong: no la chi phi xac minh DUNG
     * RIENG MOT MINH, khong lan voi chi phi thanh toan.
     */
    verifyRecordTxHash: String,
    verifyRecordGas: Number,

    /*
     * GIAI DOAN 2 — duyet va chi. Tach rieng de so duoc voi
     * `withdrawOffChain` cua nhanh off-chain (cung mot cong viec).
     */
    settleGas: Number,
}, { timestamps: true, versionKey: false });

WithdrawalRequestSchema.index({ pool: 1, scholarship: 1, status: 1 });

const WithdrawalRequest =
    mongoose.models.OnchainWithdrawalRequest
    || mongoose.model("OnchainWithdrawalRequest", WithdrawalRequestSchema, "onchain_withdrawal_requests");
module.exports = { WithdrawalRequest };
