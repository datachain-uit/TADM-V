const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Test cho mat khau + dang nhap nhan su (K9b).
 *
 * KHONG can MongoDB: `UniversityStaff` la mot object module va
 * `staffLogin` tra cuu `.findOne` LUC GOI, nen thay ham do bang
 * stub la du — giong cach authorizeStaff.test.ts lam.
 *
 * Vi sao can test nay: K9a chi chan NHAM VAI TRO (staffId la ma
 * dinh danh). K9b la thu chan MAO DANH. Neu khong co test, phan
 * "dang nhap" trong bai bao chi la loi ke. Xem STATUS.md muc K9b.
 *
 * ⚠️ Day van la xac thuc o TANG UNG DUNG, KHONG phai ranh gioi
 * tin cay mat ma — contract chi co MOT `school`. Xem DECISIONS.md
 * muc C5.
 */
const {
    UniversityStaff
} = require("../models/UniversityStaff");

const {
    hashStaffPassword,
    verifyStaffPassword,
    staffLogin
} = require("../services/staffLoginService");

const UNI = "507f1f77bcf86cd799439011";

function stubStaff(doc: any) {
    UniversityStaff.findOne = async () => doc;
}

/* ---------- bam mat khau (thuan tuy, khong DB) ---------- */

test("hashStaffPassword tao chuoi scrypt$<salt>$<hash>", () => {
    const stored = hashStaffPassword("matkhau-du-dai");
    const parts = stored.split("$");

    assert.equal(parts.length, 3);
    assert.equal(parts[0], "scrypt");
    assert.ok(parts[1].length > 0);
    assert.ok(parts[2].length > 0);
});

test("hashStaffPassword TU CHOI mat khau ngan hon 8 ky tu", () => {
    assert.throws(
        () => hashStaffPassword("ngan"),
        /at least 8 characters/
    );
});

test("hai lan bam cung mat khau cho ket qua KHAC NHAU (salt ngau nhien)", () => {
    const a = hashStaffPassword("matkhau-du-dai");
    const b = hashStaffPassword("matkhau-du-dai");

    assert.notEqual(a, b);
});

test("verifyStaffPassword dung mat khau -> true, sai -> false", () => {
    const stored = hashStaffPassword("matkhau-du-dai");

    assert.equal(
        verifyStaffPassword("matkhau-du-dai", stored),
        true
    );
    assert.equal(
        verifyStaffPassword("matkhau-sai-roi", stored),
        false
    );
});

test("verifyStaffPassword tra ve false voi chuoi luu hong, khong nem loi", () => {
    assert.equal(verifyStaffPassword("matkhau-du-dai", ""), false);
    assert.equal(verifyStaffPassword("matkhau-du-dai", "khong-phai-scrypt"), false);
    assert.equal(
        verifyStaffPassword("matkhau-du-dai", "bcrypt$abc$def"),
        false
    );
});

/* ---------- dang nhap ---------- */

test("staffLogin tra ve danh tinh + vai tro, KHONG tra ve passwordHash", async () => {
    stubStaff({
        university: UNI,
        staffId: "KHTC-01",
        role: "FINANCE",
        status: "ACTIVE",
        passwordHash: hashStaffPassword("matkhau-du-dai")
    });

    const session = await staffLogin(
        UNI,
        "KHTC-01",
        "matkhau-du-dai"
    );

    assert.equal(session.staffId, "KHTC-01");
    assert.equal(session.role, "FINANCE");
    assert.equal(session.roleLabel, "Phong Ke hoach - Tai chinh");
    assert.equal(
        Object.prototype.hasOwnProperty.call(session, "passwordHash"),
        false
    );
});

test("staffLogin TU CHOI khi sai mat khau", async () => {
    stubStaff({
        university: UNI,
        staffId: "CTSV-01",
        role: "STUDENT_AFFAIRS",
        status: "ACTIVE",
        passwordHash: hashStaffPassword("matkhau-du-dai")
    });

    await assert.rejects(
        () => staffLogin(UNI, "CTSV-01", "matkhau-sai-roi"),
        /Invalid staff credentials/
    );
});

/*
 * Sai mat khau va khong ton tai phai cho CUNG MOT thong diep,
 * neu khong ke tan cong do duoc staffId nao co that.
 */
test("staffLogin khong tiet lo staffId nao co that", async () => {
    stubStaff(null);

    await assert.rejects(
        () => staffLogin(UNI, "KHONG-CO", "matkhau-du-dai"),
        /Invalid staff credentials/
    );
});

test("staffLogin TU CHOI tai khoan bi khoa", async () => {
    stubStaff({
        university: UNI,
        staffId: "KHTC-01",
        role: "FINANCE",
        status: "INACTIVE",
        passwordHash: hashStaffPassword("matkhau-du-dai")
    });

    await assert.rejects(
        () => staffLogin(UNI, "KHTC-01", "matkhau-du-dai"),
        /not ACTIVE/
    );
});

/*
 * `seedDefaultStaff` tao tai khoan CHUA co mat khau — day la ly do
 * `passwordHash` de `required: false`. Tai khoan nhu vay phai
 * KHONG dang nhap duoc, nhung van dung duoc qua CLI (CLI khong co
 * phien dang nhap).
 */
test("staffLogin TU CHOI tai khoan chua dat mat khau", async () => {
    stubStaff({
        university: UNI,
        staffId: "CTSV-01",
        role: "STUDENT_AFFAIRS",
        status: "ACTIVE"
    });

    await assert.rejects(
        () => staffLogin(UNI, "CTSV-01", "matkhau-du-dai"),
        /no password set/
    );
});
