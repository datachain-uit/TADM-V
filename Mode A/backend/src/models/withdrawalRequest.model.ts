import mongoose from 'mongoose';

const { Schema } = mongoose;

const WithdrawalRequestSchema = new Schema(
  {
    pool: {
      type: Schema.Types.ObjectId,

      ref: 'ScholarshipPool',

      required: true,
    },

    poolContractAddress: {
      type: String,

      required: true,

      lowercase: true,

      match: /^0x[0-9a-f]{40}$/,
    },

    poolChainId: {
      type: String,

      required: true,

      match: /^[0-9]+$/,
    },

    scholarship: {
      type: Schema.Types.ObjectId,

      ref: 'StudentScholarship',

      required: true,
    },

    proof: {
      type: String,

      required: true,
    },

    calldata: {
      type: String,
    },

    expectedRoot: {
      type: String,

      required: true,

      lowercase: true,

      match: /^0x[0-9a-f]{64}$/,
    },

    expectedNullifier: {
      type: String,

      required: true,

      lowercase: true,

      match: /^0x[0-9a-f]{64}$/,
    },

    amountWei: {
      type: String,

      required: true,

      match: /^[1-9][0-9]*$/,
    },

    recipient: {
      type: String,

      required: true,

      lowercase: true,

      match: /^0x[0-9a-f]{40}$/,
    },

    localVerificationPassed: {
      type: Boolean,

      required: true,

      default: false,
    },

    verificationMs: {
      type: Number,

      min: 0,
    },

    verificationSetupMs: {
      type: Number,

      min: 0,
    },

    status: {
      type: String,

      enum: ['PENDING_APPROVAL', 'REJECTED', 'EXECUTED', 'EXECUTION_FAILED'],

      required: true,

      default: 'PENDING_APPROVAL',
    },

    proofPreparedAt: {
      type: Date,

      required: true,
    },

    reviewedAt: {
      type: Date,
    },

    transactionHash: {
      type: String,
    },

    withdrawGasUsed: {
      type: String,

      match: /^[0-9]+$/,
    },

    failureReason: {
      type: String,
    },
  },

  {
    timestamps: true,

    versionKey: false,
  },
);

WithdrawalRequestSchema.index({
  pool: 1,

  scholarship: 1,

  status: 1,
});

const WithdrawalRequest: mongoose.Model<any> =
  mongoose.models.WithdrawalRequest || mongoose.model('WithdrawalRequest', WithdrawalRequestSchema);

export { WithdrawalRequest };
