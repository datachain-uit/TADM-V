const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

const UniversitySchema =
    new Schema(
        {
            name: {
                type: String,
                required: true,
                trim: true,
                unique: true
            },

            walletAddress: {
                type: String,
                required: true,
                trim: true,
                lowercase: true,
                unique: true,
                match: /^0x[0-9a-f]{40}$/
            },

            status: {
                type: String,
                enum: [
                    "ACTIVE",
                    "INACTIVE"
                ],
                default: "ACTIVE",
                required: true
            }
        },
        {
            timestamps: true,
            versionKey: false
        }
    );

const University =
    mongoose.models.University
    ||
    mongoose.model(
        "University",
        UniversitySchema
    );

module.exports = {
    University
};
