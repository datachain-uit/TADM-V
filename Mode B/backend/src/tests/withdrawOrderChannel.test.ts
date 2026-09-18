/*
 * ===================================================================
 * KENH THU TU cua `R4` — V2 xao tron truoc khi giai ngan
 * ===================================================================
 *
 * KENH NAY LA GI. `ShieldedPool` dat `onlySchool` tren ham rut, nen MOI
 * lan rut deu di qua MOT tai khoan cua nha truong => mot chuoi nonce =>
 * thu tu tren chuoi BANG DUNG thu tu backend giai ngan.
 *
 * Quan sat vien biet thu tu nop don chi can dem: don thu 7 nop len thi
 * lay lan rut thu 7 tren chuoi. Khong can biet so tien, khong can biet
 * vi. Day la mot duong nham hoan toan doc lap voi hai kenh kia.
 *
 * `ISO/IEC 15408-2` muc 14.4.5, NOTE duoi `FPR_UNL.1.1`:
 *   "This SFR intends to look at a chain of interlinked operations by
 *    multiple entities. This chain can be subsumed as a transaction."
 *
 * VI SAO TEST THAY VI CHAY THUC NGHIEM. Thuc nghiem an danh mat ~5 gio
 * moi repo. Nhung dieu can chung minh o day la TAT DINH: hoan vi sau khi
 * xao tron khac hoan vi dong nhat, va no tai lap duoc theo seed. Do la
 * tinh chat cua ham, kiem bang test la du va chat hon — chay mot luot
 * chi cho MOT mau hoan vi, con test kiem duoc nhieu seed.
 *
 * ⚠️ GIOI HAN PHAI KHAI. Test nay chung minh CO CHE xao tron hoat dong.
 * No KHONG chung minh end-to-end rang thu tu tren chuoi that su khac thu
 * tu nop don trong mot luot chay day du — phep do do thuoc thuc nghiem
 * an danh, chua chay.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    xaoTron,
    prngTuSeed
} = require("../experiments/anonymityExperiment");

function day(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
}

function soViTriGiuNguyen(goc: number[], sau: number[]): number {
    return goc.filter((x, i) => sau[i] === x).length;
}

test("kenh thu tu — xao tron KHONG tra ve hoan vi dong nhat", () => {
    /*
     * Neu xao tron tra lai dung day cu thi kenh thu tu VAN HO: vi tri
     * tren chuoi van bang vi tri nop don.
     */
    const n = 500;
    const goc = day(n);
    const sau = xaoTron(goc, 12345);

    assert.notDeepEqual(
        sau,
        goc,
        "xao tron phai doi thu tu, neu khong thi kenh thu tu khong bi bit"
    );
});

test("kenh thu tu — hau het vi tri bi doi, khong chi vai cho", () => {
    /*
     * Doi duoc mot hai cho thi chua du. Voi hoan vi ngau nhien dung, so
     * phan tu O NGUYEN VI TRI CU ky vong la 1 (bat ke n) — day la bai
     * toan "so diem bat dong cua hoan vi ngau nhien".
     *
     * Cho phep toi da 10 de khong bap benh theo seed, nhung van bat duoc
     * truong hop xao tron hong (luc do se la 500).
     */
    const n = 500;
    const goc = day(n);
    const sau = xaoTron(goc, 987654321);
    const giuNguyen = soViTriGiuNguyen(goc, sau);

    assert.ok(
        giuNguyen <= 10,
        "so vi tri giu nguyen = " + giuNguyen + "/500, qua nhieu."
        + " Hoan vi ngau nhien dung phai co ky vong khoang 1"
    );
});

test("kenh thu tu — TAI LAP DUOC: cung seed cho cung ket qua", () => {
    /*
     * Bat buoc cho tinh tai lap cua thuc nghiem. Neu xao tron dung
     * `Math.random()` thi khong ai kiem lai duoc luot chay da cong bo.
     */
    const goc = day(200);

    assert.deepEqual(
        xaoTron(goc, 42),
        xaoTron(goc, 42),
        "cung seed phai cho cung hoan vi"
    );
});

test("kenh thu tu — seed khac cho hoan vi khac", () => {
    const goc = day(200);

    assert.notDeepEqual(
        xaoTron(goc, 42),
        xaoTron(goc, 43),
        "seed khac ma ra cung hoan vi thi seed khong co tac dung"
    );
});

test("kenh thu tu — xao tron KHONG lam mat hay nhan doi phan tu nao", () => {
    /*
     * Chot chan an toan: mot loi cai dat Fisher-Yates de lam mat phan tu
     * hoac nhan doi no. Neu vay thi co sinh vien khong duoc giai ngan,
     * hoac duoc giai ngan hai lan.
     */
    const n = 500;
    const goc = day(n);
    const sau = xaoTron(goc, 2026);

    assert.equal(sau.length, n, "phai giu nguyen so phan tu");

    assert.deepEqual(
        [...sau].sort((a, b) => a - b),
        goc,
        "sap xep lai phai ra dung tap ban dau - khong mat, khong trung"
    );
});

test("kenh thu tu — PRNG cho so trong [0, 1)", () => {
    const rand = prngTuSeed(7);

    for (let i = 0; i < 1000; i += 1) {
        const x = rand();

        assert.ok(
            x >= 0 && x < 1,
            "PRNG tra ve " + x + ", nam ngoai [0, 1)"
        );
    }
});
