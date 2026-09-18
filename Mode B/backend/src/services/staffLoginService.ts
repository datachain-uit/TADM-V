const crypto = require("crypto");
const { UniversityStaff } = require("../models/UniversityStaff");
const { authorizeAnyStaff, ROLE_LABEL } = require("./authorizeStaffService");

/*
 * K9b — mat khau cho tai khoan nhan su. Doi xung voi ADV.
 *
 * ⚠️ RANH GIOI PHAI GIU, xem code/DECISIONS.md muc C5:
 *  - Xac thuc o TANG UNG DUNG, KHONG phai ranh gioi tin cay mat ma.
 *    Contract van chi co MOT `school`.
 *  - CLI KHONG co phien dang nhap. 11 lenh CLI van chi nhan `staffId`.
 *    CLI la cong cu nghien cuu / quan tri — bai bao phai noi thang.
 *  - Cuong che dang nhap nam o ranh gioi frontend/API: goi `staffLogin`
 *    -> giu phien -> truyen `staffId` xuong cac service da gac (K6/K9a).
 *
 * Dung `scrypt` cua Node — khong them dependency nao.
 */

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

function hashStaffPassword(password: string): string {
    if (typeof password !== "string" || password.length < 8) {
        throw new Error("Password must be at least 8 characters");
    }
    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
    return "scrypt$" + salt + "$" + derived;
}

function verifyStaffPassword(password: string, stored: string): boolean {
    if (!stored || typeof stored !== "string" || typeof password !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = parts[1];
    const hex = parts[2];
    // `noUncheckedIndexedAccess` — phai kiem tra tuong minh. Chuoi rong
    // cung bi loai: keylen 0 se lam `scryptSync` nem loi.
    if (!salt || !hex) return false;
    const expected = Buffer.from(hex, "hex");
    if (expected.length === 0) return false;
    const derived = crypto.scryptSync(password, salt, expected.length);
    // So sanh theo thoi gian hang so.
    return crypto.timingSafeEqual(derived, expected);
}

/*
 * Dat / doi mat khau. Phai co nhan su hien huu bao lanh — cung mot cong
 * voi createUniversityStaff (K9a), de khong tao duong vong.
 */
async function setStaffPassword(
    universityId: string,
    actingStaffId: string,
    staffId: string,
    password: string
) {
    if (!universityId || !actingStaffId || !staffId) {
        throw new Error("A universityId, actingStaffId and staffId are required");
    }

    const actingStaff = await authorizeAnyStaff(universityId, actingStaffId);

    const staff = await UniversityStaff.findOne({ university: universityId, staffId });
    if (!staff) throw new Error("Staff not found in this university: " + staffId);

    staff.passwordHash = hashStaffPassword(password);
    await staff.save();

    console.log("STAFF PASSWORD UPDATED");
    console.log("dat boi:", actingStaff.staffId, "-", ROLE_LABEL[actingStaff.role]);
    console.log("staffId:", staff.staffId);

    return { staffId: staff.staffId, role: staff.role };
}

/*
 * Dang nhap. Tra ve danh tinh + vai tro de tang goi giu phien
 * va quyet dinh HIEN THI gi. KHONG tra ve passwordHash.
 */
async function staffLogin(universityId: string, staffId: string, password: string) {
    if (!universityId || !staffId || !password) {
        throw new Error("A universityId, staffId and password are required");
    }

    const staff = await UniversityStaff.findOne({ university: universityId, staffId });

    // Mot thong diep duy nhat cho moi that bai: khong tiet lo staffId nao co that.
    const FAILED = "Invalid staff credentials";

    if (!staff) throw new Error(FAILED);
    if (staff.status !== "ACTIVE") throw new Error("Staff account is not ACTIVE: " + staffId);
    if (!staff.passwordHash) {
        throw new Error("Staff has no password set: " + staffId + " — dung setStaffPassword truoc");
    }
    if (!verifyStaffPassword(password, staff.passwordHash)) throw new Error(FAILED);

    return {
        universityId: String(staff.university),
        staffId: staff.staffId,
        role: staff.role,
        roleLabel: ROLE_LABEL[staff.role],
    };
}

module.exports = { hashStaffPassword, verifyStaffPassword, setStaffPassword, staffLogin };
