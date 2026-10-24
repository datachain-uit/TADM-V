import mongoose from 'mongoose';
const { Schema } = mongoose;

const WithdrawalRequestSchema = new Schema(
  {
    pool: { type: Schema.Types.ObjectId, ref: 'OnchainScholarshipPool', required: true },
    scholarship: { type: Schema.Types.ObjectId, ref: 'OnchainStudentScholarship', required: true },
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
      enum: ['PENDING_APPROVAL', 'REJECTED', 'EXECUTED', 'EXECUTION_FAILED'],
      default: 'PENDING_APPROVAL',
      required: true,
    },
    proofPreparedAt: { type: Date, required: true },
    reviewedAt: Date,
    transactionHash: String,
    failureReason: String,
    gasLimit: Number,

    verifyRecordTxHash: String,
    verifyRecordGas: Number,

    settleGas: Number,
  },
  { timestamps: true, versionKey: false },
);

WithdrawalRequestSchema.index({ pool: 1, scholarship: 1, status: 1 });

const WithdrawalRequest: mongoose.Model<any> =
  mongoose.models.OnchainWithdrawalRequest ||
  mongoose.model('OnchainWithdrawalRequest', WithdrawalRequestSchema, 'onchain_withdrawal_requests');
export { WithdrawalRequest };
