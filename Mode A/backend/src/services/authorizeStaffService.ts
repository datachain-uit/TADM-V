const {
    UniversityStaff
} = require("../models/UniversityStaff");

/*
 * Cổng kiểm vai trò dùng chung cho ba bước phê duyệt.
 *
 * Trả về document nhân sự nếu hợp lệ, throw nếu không.
 * Gom vào một chỗ để ba service không viết lại logic
 * này ba lần, và để chỉ có MỘT nơi phải sửa khi đổi
 * cách xác thực.
 *
 * ⚠️ Kiểm ở tầng backend, KHÔNG phải ranh giới tin cậy
 * mật mã — xem code/DECISIONS.md mục C5.
 */
async function authorizeStaff(
    universityId: string,
    staffId: string,
    requiredRole: "STUDENT_AFFAIRS" | "FINANCE"
) {
    if (
        !universityId
        || !staffId
    ) {
        throw new Error(
            "A universityId and staffId are required"
        );
    }

    const staff = await UniversityStaff.findOne({
        university: universityId,
        staffId
    });

    if (!staff) {
        throw new Error(
            "Staff not found in this university: " + staffId
        );
    }

    if (staff.status !== "ACTIVE") {
        throw new Error(
            "Staff account is not ACTIVE: " + staffId
        );
    }

    if (staff.role !== requiredRole) {
        throw new Error(
            "Role mismatch: this step requires "
            + requiredRole
            + ", but staff "
            + staffId
            + " has role "
            + staff.role
        );
    }

    return staff;
}

const ROLE_LABEL: Record<string, string> = {
    STUDENT_AFFAIRS: "Phong Cong tac Sinh vien",
    FINANCE: "Phong Ke hoach - Tai chinh"
};


/*
 * Bien the KHONG rang buoc vai tro: chi can la nhan su
 * hop le, con ACTIVE, thuoc dung truong.
 *
 * Dung cho `createUniversityStaff` — tao nhan su moi thi
 * chi can mot nhan su hien huu bao lanh, khong quan trong
 * phong nao. Xem STATUS.md muc K9.
 */
async function authorizeAnyStaff(
    universityId: string,
    staffId: string
) {
    if (
        !universityId
        || !staffId
    ) {
        throw new Error(
            "A universityId and staffId are required"
        );
    }

    const staff = await UniversityStaff.findOne({
        university: universityId,
        staffId
    });

    if (!staff) {
        throw new Error(
            "Staff not found in this university: " + staffId
        );
    }

    if (staff.status !== "ACTIVE") {
        throw new Error(
            "Staff account is not ACTIVE: " + staffId
        );
    }

    return staff;
}

module.exports = {
    authorizeStaff,
    authorizeAnyStaff,
    ROLE_LABEL
};
