import mongoose from 'mongoose';

const { Schema } = mongoose;

const UniversityStaffSchema = new Schema(
  {
    university: { type: Schema.Types.ObjectId, ref: 'OnchainUniversity', required: true },
    staffId: { type: String, required: true, trim: true },
    role: { type: String, enum: ['STUDENT_AFFAIRS', 'FINANCE'], required: true },
    passwordHash: { type: String, required: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', required: true },
  },
  { timestamps: true, versionKey: false },
);

UniversityStaffSchema.index({ university: 1, staffId: 1 }, { unique: true });

const UniversityStaff: mongoose.Model<any> =
  mongoose.models.OnchainUniversityStaff ||
  mongoose.model('OnchainUniversityStaff', UniversityStaffSchema, 'onchain_university_staffs');
export { UniversityStaff };
