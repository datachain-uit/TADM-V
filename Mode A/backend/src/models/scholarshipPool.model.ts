import mongoose from 'mongoose';

const { Schema } = mongoose;

const RootHistorySchema = new Schema(
  {
    root: { type: String, required: true, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
    transactionHash: { type: String, required: true, lowercase: true },
    approvedAt: { type: Date, required: true },
  },
  { _id: false },
);

const ScholarshipPoolSchema = new Schema(
  {
    university: {
      type: Schema.Types.ObjectId,
      ref: 'University',
      required: true,
    },

    programName: {
      type: String,
      required: true,
      trim: true,
      default: 'Academic Encouragement Scholarship',
    },

    universityAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^0x[0-9a-f]{40}$/,
    },

    contractAddress: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^0x[0-9a-f]{40}$/,
    },

    chainId: {
      type: String,
      match: /^[0-9]+$/,
    },

    deploymentTransactionHash: {
      type: String,
      lowercase: true,
      match: /^0x[0-9a-f]{64}$/,
    },

    denominationWei: {
      type: String,
      required: true,
      default: '0',
      match: /^[0-9]+$/,
    },

    initialFundingWei: {
      type: String,
      required: true,
      default: '0',
      match: /^[0-9]+$/,
    },

    deploymentGasUsed: {
      type: String,
      match: /^[0-9]+$/,
    },

    lastRootUpdateGasUsed: {
      type: String,
      match: /^[0-9]+$/,
    },

    currentRoot: { type: String, lowercase: true, match: /^0x[0-9a-f]{64}$/ },

    rootHistory: { type: [RootHistorySchema], default: [] },

    merkleZeros: {
      type: [String],
      default: undefined,
    },

    merkleDepth: {
      type: Number,
      min: 1,
    },

    status: {
      type: String,
      enum: ['PENDING_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'DEPLOYMENT_FAILED'],
      required: true,
      default: 'PENDING_DEPLOYMENT',
    },

    deploymentError: {
      type: String,
    },

    deployedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ScholarshipPoolSchema.index(
  {
    university: 1,
    programName: 1,
  },
  {
    unique: true,
  },
);

ScholarshipPoolSchema.index(
  {
    contractAddress: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      contractAddress: {
        $type: 'string',
      },
    },
  },
);

const ScholarshipPool: mongoose.Model<any> =
  mongoose.models.ScholarshipPool || mongoose.model('ScholarshipPool', ScholarshipPoolSchema);

export { ScholarshipPool };
