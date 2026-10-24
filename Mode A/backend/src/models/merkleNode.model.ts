import mongoose from 'mongoose';

const { Schema } = mongoose;

const MerkleNodeSchema = new Schema(
  {
    pool: {
      type: Schema.Types.ObjectId,

      ref: 'ScholarshipPool',

      required: true,
    },

    level: {
      type: Number,

      required: true,

      min: 0,
    },

    index: {
      type: Number,

      required: true,

      min: 0,
    },

    hash: {
      type: String,

      required: true,

      trim: true,

      match: /^0x[0-9a-fA-F]{64}$/,
    },
  },

  {
    timestamps: true,
  },
);

MerkleNodeSchema.index(
  {
    pool: 1,
    level: 1,
    index: 1,
  },

  {
    unique: true,
  },
);

const MerkleNode: mongoose.Model<any> = mongoose.models.MerkleNode || mongoose.model('MerkleNode', MerkleNodeSchema);

export { MerkleNode };
