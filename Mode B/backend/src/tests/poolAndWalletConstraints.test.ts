/*
 * ===================================================================
 * A19 + A21 — HAI RANG BUOC RIENG TU O TANG DU LIEU
 * ===================================================================
 *
 * VI SAO CO FILE NAY. Hai thay doi nay la CO CHE duy nhat dong kenh
 * "gop nhieu pool" cua `FPR_UNL.1` (ISO/IEC 15408-2 muc 14.4.5), nhung
 * truoc 2026-09-02 KHONG CO PHEP KIEM NAO cham vao chung. Bao cao ghi
 * la da lam, ma khong co gi chung minh — mot lan sua nham vao schema se
 * khong ai biet cho toi khi doc lai artifact.
 *
 * KIEM O TANG NAO. Cac test khac trong thu muc nay khong ket noi
 * MongoDB (chung kiem ABI va ham thuan), va file nay giu dung le do: no
 * doc KHAI BAO INDEX cua Mongoose chu khong mo ket noi. Nho vay
 * `npm test` van chay duoc khi khong co Atlas, va van bat duoc dung thu
 * A19/A21 da sua.
 *
 * 🔴 CAI NAY KHONG KIEM DUOC: index da nam san trong database that.
 * Bo `unique` trong schema KHONG xoa index cu tren cum Mongo — phai chay
 * `src/scripts/dropLegacyPoolIndex.ts`. Test nay chi noi ve MA NGUON.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ScholarshipPool
} = require("../models/ScholarshipPool");

const {
    StudentScholarship
} = require("../models/StudentScholarship");

/*
 * `schema.indexes()` tra ve mang [ khoa, tuychon ] cho tung index da
 * khai bao bang `.index(...)`. Cac `unique: true` dat ngay trong dinh
 * nghia truong thi KHONG nam o day — chung nam trong `schema.path()`,
 * nen phai kiem ca hai cho.
 */
function timIndex(schema: any, khoa: string[]) {
    return schema.indexes().find(
        ([fields]: [Record<string, unknown>]) => {
            const ten = Object.keys(fields);

            return ten.length === khoa.length
                && khoa.every((k) => ten.includes(k));
        }
    );
}

test("A19 — mot truong duoc mo NHIEU chuong trinh hoc bong", () => {
    /*
     * Truoc A19, `university` mang `unique: true` ngay trong dinh nghia
     * truong => moi truong chi mot pool VINH VIEN. Do la rang buoc sai
     * nghiep vu: mot truong cap hoc bong moi hoc ky.
     */
    const truongUniversity = ScholarshipPool.schema.path("university");

    assert.equal(
        Boolean(truongUniversity?.options?.unique),
        false,
        "`university` KHONG duoc mang unique - neu khong, moi truong chi"
        + " duoc mot pool va A19 hong"
    );

    // Thay bang index ghep: cung truong thi ten chuong trinh phai khac.
    const ghep = timIndex(
        ScholarshipPool.schema,
        ["university", "programName"]
    );

    assert.ok(
        ghep,
        "phai co index ghep {university, programName}"
    );

    assert.equal(
        ghep[1]?.unique,
        true,
        "index ghep phai unique - neu khong, mot truong tao duoc hai"
        + " chuong trinh TRUNG TEN"
    );
});

test("A19 — programName la truong bat buoc, co mac dinh", () => {
    /*
     * Bat buoc thi index ghep moi co nghia; co mac dinh thi moi loi goi
     * cu `createScholarshipPool(uni, staff)` van chay duoc.
     */
    const truong = ScholarshipPool.schema.path("programName");

    assert.ok(truong, "phai co truong `programName`");

    assert.equal(
        truong.isRequired,
        true,
        "`programName` phai bat buoc"
    );

    assert.ok(
        truong.defaultValue,
        "`programName` phai co gia tri mac dinh de khong pha loi goi cu"
    );
});

test("A21 — mot vi chi dung cho DUNG MOT suat hoc bong, toan cuc", () => {
    /*
     * DAY LA CO CHE DONG KENH "gop nhieu pool" cua `FPR_UNL.1`.
     *
     * Neu sinh vien dung lai mot vi o hai chuong trinh, quan sat vien
     * thay cung dia chi trong `event Withdraw` cua CA HAI pool, giao hai
     * tap ung vien lai => tap an danh co lai.
     *
     * Index phai la TOAN CUC tren `walletAddress`. Index cu
     * {pool, walletAddress} chi chan trung TRONG MOT pool — qua pool khac
     * thi dung lai thoai mai, tuc khong dong duoc kenh nao ca.
     */
    const toanCuc = timIndex(
        StudentScholarship.schema,
        ["walletAddress"]
    );

    assert.ok(
        toanCuc,
        "phai co index TOAN CUC tren `walletAddress` - index"
        + " {pool, walletAddress} la KHONG DU"
    );

    assert.equal(
        toanCuc[1]?.unique,
        true,
        "index toan cuc phai unique, neu khong thi khong chan duoc gi"
    );
});

test("A21 — chan VINH VIEN, khong phu thuoc trang thai pool", () => {
    /*
     * Su kien tren chuoi la VINH CUU: vi da xuat hien o pool A thi du
     * pool A dong lai, dung lai vi do o pool B VAN tao lien ket.
     *
     * Nen index toan cuc KHONG duoc mang `partialFilterExpression` loc
     * theo trang thai - lam vay la chan co dieu kien, va lien ket cu van
     * con nguyen tren chuoi.
     */
    const toanCuc = timIndex(
        StudentScholarship.schema,
        ["walletAddress"]
    );

    assert.equal(
        toanCuc[1]?.partialFilterExpression,
        undefined,
        "index toan cuc khong duoc loc theo trang thai - su kien cu tren"
        + " chuoi khong bien mat khi pool dong"
    );
});
