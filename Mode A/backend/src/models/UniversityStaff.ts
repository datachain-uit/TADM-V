const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

/*
 * Nhân sự của một trường, kèm PHÒNG BAN.
 *
 * Lý do tồn tại: trước đây ba bước phê duyệt chỉ
 * nhận `universityId`, không kiểm ai gọi — nên hình
 * kiến trúc vẽ hai phòng ban là mô tả nghiệp vụ,
 * không phải ràng buộc hệ thống ép được.
 *
 * ⚠️ Đây là kiểm quyền ở TẦNG BACKEND, KHÔNG phải
 * ranh giới tin cậy mật mã. Contract vẫn chỉ có một
 * `school` duy nhất (`onlySchool`). Bài báo được mô
 * tả đây là quy trình hai bước có ràng buộc thứ tự
 * và ràng buộc vai trò, nhưng KHÔNG được tuyên bố
 * là tính chất bảo mật.
 * Xem code/DECISIONS.md mục C5.
 */
const UniversityStaffSchema =
    new Schema(
        {
            university: {
                type: Schema.Types.ObjectId,
                ref: "University",
                required: true
            },

            staffId: {
                type: String,
                required: true,
                trim: true
            },

            role: {
                type: String,
                enum: [
                    "STUDENT_AFFAIRS",
                    "FINANCE"
                ],
                required: true
            },

            /*
             * K9b — REQUIRED: FALSE, co chu y.
             *
             * `seedDefaultStaff` tao tai khoan khoi tao ma
             * KHONG co mat khau. Bat buoc truong nay se lam
             * vo hai runner thuc nghiem. Xem STATUS.md muc K9b.
             */
            passwordHash: {
                type: String,
                required: false
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

/*
 * `staffId` chỉ cần duy nhất TRONG một trường,
 * không duy nhất toàn hệ thống.
 */
UniversityStaffSchema.index(
    {
        university: 1,
        staffId: 1
    },
    {
        unique: true
    }
);

const UniversityStaff =
    mongoose.models.UniversityStaff
    ||
    mongoose.model(
        "UniversityStaff",
        UniversityStaffSchema
    );

module.exports = {
    UniversityStaff
};
