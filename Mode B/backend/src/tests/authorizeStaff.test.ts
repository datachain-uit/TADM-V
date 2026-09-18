const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Test cho cong kiem vai tro (K6 + K9).
 *
 * KHONG can MongoDB: `UniversityStaff` la mot object module,
 * `authorizeStaff` tra cuu `.findOne` LUC GOI, nen thay ham do
 * bang stub la du. Require cache dam bao service va test nhin
 * thay cung mot object.
 *
 * Vi sao can test nay: truoc do co CHINH XAC 0 test cho co che
 * phan quyen o ca hai repo — co che khong test duoc thi trong
 * bai bao chi la loi ke. Xem STATUS.md muc K9.
 */
const {
    UniversityStaff
} = require("../models/UniversityStaff");

const {
    authorizeStaff,
    authorizeAnyStaff
} = require("../services/authorizeStaffService");

const UNI = "507f1f77bcf86cd799439011";

function stubStaff(doc: any) {
    UniversityStaff.findOne = async () => doc;
}

test("authorizeStaff tra ve staff khi dung vai tro", async () => {
    stubStaff({
        staffId: "CTSV-01",
        role: "STUDENT_AFFAIRS",
        status: "ACTIVE"
    });

    const staff = await authorizeStaff(
        UNI,
        "CTSV-01",
        "STUDENT_AFFAIRS"
    );

    assert.equal(staff.staffId, "CTSV-01");
});

test("authorizeStaff TU CHOI khi sai vai tro", async () => {
    stubStaff({
        staffId: "CTSV-01",
        role: "STUDENT_AFFAIRS",
        status: "ACTIVE"
    });

    await assert.rejects(
        () => authorizeStaff(UNI, "CTSV-01", "FINANCE"),
        /Role mismatch/
    );
});

test("authorizeStaff TU CHOI khi staff khong ton tai", async () => {
    stubStaff(null);

    await assert.rejects(
        () => authorizeStaff(UNI, "KHONG-CO", "FINANCE"),
        /Staff not found/
    );
});

test("authorizeStaff TU CHOI khi tai khoan bi khoa", async () => {
    stubStaff({
        staffId: "KHTC-01",
        role: "FINANCE",
        status: "INACTIVE"
    });

    await assert.rejects(
        () => authorizeStaff(UNI, "KHTC-01", "FINANCE"),
        /not ACTIVE/
    );
});

test("authorizeStaff TU CHOI khi thieu staffId", async () => {
    stubStaff({
        staffId: "KHTC-01",
        role: "FINANCE",
        status: "ACTIVE"
    });

    await assert.rejects(
        () => authorizeStaff(UNI, "", "FINANCE"),
        /universityId and staffId are required/
    );
});

/*
 * `authorizeAnyStaff` la cong cho `createUniversityStaff` (K9):
 * chi can MOT nhan su hien huu bao lanh, khong quan trong phong nao —
 * nhung van phai ton tai va con ACTIVE.
 */
test("authorizeAnyStaff chap nhan MOI vai tro hop le", async () => {
    for (const role of ["STUDENT_AFFAIRS", "FINANCE"]) {
        stubStaff({
            staffId: "X-01",
            role,
            status: "ACTIVE"
        });

        const staff = await authorizeAnyStaff(UNI, "X-01");
        assert.equal(staff.role, role);
    }
});

test("authorizeAnyStaff VAN chan tai khoan bi khoa", async () => {
    stubStaff({
        staffId: "X-01",
        role: "FINANCE",
        status: "INACTIVE"
    });

    await assert.rejects(
        () => authorizeAnyStaff(UNI, "X-01"),
        /not ACTIVE/
    );
});
