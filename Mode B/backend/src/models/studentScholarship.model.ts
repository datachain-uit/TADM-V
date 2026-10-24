import mongoose from 'mongoose';
const { Schema } = mongoose;

const StudentScholarshipSchema = new Schema(
  {
    pool: { type: Schema.Types.ObjectId, ref: 'OnchainScholarshipPool', required: true },
    universityStudent: { type: Schema.Types.ObjectId, ref: 'OnchainUniversityStudent', required: true },
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
      enum: ['WALLET_REGISTERED', 'NOTE_CREATED', 'ROOT_APPROVED', 'WITHDRAWAL_REQUESTED', 'WITHDRAWN'],
      default: 'WALLET_REGISTERED',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

StudentScholarshipSchema.index({ pool: 1, universityStudent: 1 }, { unique: true });
StudentScholarshipSchema.index({ walletAddress: 1 }, { unique: true });

StudentScholarshipSchema.index({ pool: 1, walletAddress: 1 }, { unique: true });
StudentScholarshipSchema.index(
  { encryptedNoteCid: 1 },
  { unique: true, partialFilterExpression: { encryptedNoteCid: { $type: 'string' } } },
);
StudentScholarshipSchema.index(
  { commitment: 1 },
  { unique: true, partialFilterExpression: { commitment: { $type: 'string' } } },
);
StudentScholarshipSchema.index(
  { pool: 1, merkleIndex: 1 },
  { unique: true, partialFilterExpression: { merkleIndex: { $type: 'number' } } },
);

const StudentScholarship: mongoose.Model<any> =
  mongoose.models.OnchainStudentScholarship ||
  mongoose.model('OnchainStudentScholarship', StudentScholarshipSchema, 'onchain_student_scholarships');
export { StudentScholarship };
