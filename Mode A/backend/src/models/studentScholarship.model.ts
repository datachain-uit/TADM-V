import mongoose from 'mongoose';

const { Schema } = mongoose;

const StudentScholarshipSchema = new Schema(
  {
    pool: {
      type: Schema.Types.ObjectId,

      ref: 'ScholarshipPool',

      required: true,
    },

    universityStudent: {
      type: Schema.Types.ObjectId,

      ref: 'UniversityStudent',

      required: true,
    },

    walletAddress: {
      type: String,

      required: true,

      trim: true,

      lowercase: true,

      match: /^0x[0-9a-f]{40}$/,
    },

    publicKey: {
      type: String,

      required: true,

      trim: true,
    },

    encryptedNoteCid: {
      type: String,

      trim: true,
    },

    approvedRoot: { type: String, lowercase: true, match: /^0x[0-9a-f]{64}$/ },

    rootTransactionHash: { type: String, lowercase: true },

    commitment: {
      type: String,

      lowercase: true,

      match: /^0x[0-9a-f]{64}$/,
    },

    merkleIndex: {
      type: Number,

      min: 0,
    },

    status: {
      type: String,

      enum: ['WALLET_REGISTERED', 'NOTE_CREATED', 'ROOT_APPROVED', 'WITHDRAWAL_REQUESTED', 'WITHDRAWN'],

      required: true,

      default: 'WALLET_REGISTERED',
    },

    withdrawTxHash: {
      type: String,
    },
  },

  {
    timestamps: true,

    versionKey: false,
  },
);

StudentScholarshipSchema.index(
  {
    pool: 1,

    universityStudent: 1,
  },
  {
    unique: true,
  },
);

StudentScholarshipSchema.index(
  {
    walletAddress: 1,
  },
  {
    unique: true,
  },
);

StudentScholarshipSchema.index(
  {
    pool: 1,

    walletAddress: 1,
  },
  {
    unique: true,
  },
);

StudentScholarshipSchema.index(
  {
    encryptedNoteCid: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      encryptedNoteCid: {
        $type: 'string',
      },
    },
  },
);

StudentScholarshipSchema.index(
  {
    commitment: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      commitment: {
        $type: 'string',
      },
    },
  },
);

StudentScholarshipSchema.index(
  {
    pool: 1,

    merkleIndex: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      merkleIndex: {
        $type: 'number',
      },
    },
  },
);

const StudentScholarship: mongoose.Model<any> =
  mongoose.models.StudentScholarship || mongoose.model('StudentScholarship', StudentScholarshipSchema);

export { StudentScholarship };
