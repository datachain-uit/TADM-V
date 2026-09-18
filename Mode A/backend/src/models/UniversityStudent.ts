const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

const UniversityStudentSchema =
    new Schema(
        {
            university: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    "University",

                required:
                    true
            },

            studentId: {
                type:
                    Number,

                required:
                    true,

                min:
                    1
            },

            email: {
                type:
                    String,

                required:
                    true,

                trim:
                    true,

                lowercase:
                    true
            },

            eligibilityStatus: {
                type:
                    String,

                enum: [
                    "PENDING",
                    "ELIGIBLE",
                    "REJECTED"
                ],

                required:
                    true,

                default:
                    "PENDING"
            },

            financeStatus: {
                type:
                    String,

                enum: [
                    "PENDING",
                    "APPROVED",
                    "REJECTED"
                ],

                required:
                    true,

                default:
                    "PENDING"
            },

            // Lưu wei bằng decimal string.
            // Không sử dụng JavaScript Number.
            amountWei: {
                type:
                    String,

                match:
                    /^[1-9][0-9]*$/
            },

            eligibilityApprovedAt: {
                type:
                    Date
            },

            financeApprovedAt: {
                type:
                    Date
            }
        },

        {
            timestamps:
                true,

            versionKey:
                false
        }
    );

UniversityStudentSchema.index(
    {
        university:
            1,

        studentId:
            1
    },
    {
        unique:
            true
    }
);

UniversityStudentSchema.index(
    {
        university:
            1,

        email:
            1
    },
    {
        unique:
            true
    }
);

const UniversityStudent =
    mongoose.models.UniversityStudent
    ||
    mongoose.model(
        "UniversityStudent",
        UniversityStudentSchema
    );

module.exports = {
    UniversityStudent
};
