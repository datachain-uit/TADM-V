import mongoose from 'mongoose';
const { Schema } = mongoose;

const UniversityStudentSchema = new Schema(
  {
    university: { type: Schema.Types.ObjectId, ref: 'OnchainUniversity', required: true },
    studentId: { type: Number, required: true, min: 1 },
    email: { type: String, required: true, trim: true, lowercase: true },
    eligibilityStatus: {
      type: String,
      enum: ['PENDING', 'ELIGIBLE', 'REJECTED'],
      default: 'PENDING',
      required: true,
    },
    financeStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      required: true,
    },
    amountWei: { type: String, match: /^[1-9][0-9]*$/ },
    eligibilityApprovedAt: Date,
    financeApprovedAt: Date,
    passwordHash: { type: String, required: false },
    mustChangePassword: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

UniversityStudentSchema.index({ university: 1, studentId: 1 }, { unique: true });
UniversityStudentSchema.index({ university: 1, email: 1 }, { unique: true });

const UniversityStudent: mongoose.Model<any> =
  mongoose.models.OnchainUniversityStudent ||
  mongoose.model('OnchainUniversityStudent', UniversityStudentSchema, 'onchain_university_students');
export { UniversityStudent };
