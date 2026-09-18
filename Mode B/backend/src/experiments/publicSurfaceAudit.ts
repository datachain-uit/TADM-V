// Kiem toan be mat cong khai.
//
// Hai lop kiem, co chu y tach roi:
//   Lop 1 - TEN truong: bat ro ri do dat ten (`rho`, `student_id`, ...).
//   Lop 2 - GIA TRI: bat ro ri khi gia tri bi day vao mot truong ten khac.
//
// Lop 2 duoc them 2026-08-14 de xu ly gioi han L2 ghi trong
// `paper/working/00_contributions.md` muc C6: ban cu CHI khop ten truong.

const PRIVATE_WITNESS_NAMES = [
    "student_id",
    "rho",
    "siblings",
    "directions"
];

// Chuoi ngan hon nguong nay se trung ngau nhien trong hex cua proof.
// Xac suat mot chuoi hex do dai L trung ngau nhien trong be mat cong
// khai ~28 000 ky tu (ONC, n = 1) la ~28000 / 16^L:
//   L=4 ~43%   L=5 ~2,7%   L=6 ~0,17%   L=7 ~0,011%
//
// ⚠️ 28 000 la con so cua n = 1. Do that: n = 100 ra 841 549 ky tu
// (luot 24/08), va tu 25/08 — khi be mat them calldata ON-CHAIN cua
// `verifyAndRecord` — la ~1 534 000 ky tu.
//
// NHUNG nguong 7 KHONG phai nang len. Phan them vao la CUNG NHUNG BYTE
// PROOF DO, chi khac lop boc ABI. Lap lai mot chuoi khong tao them co
// hoi chua mot chuoi con ma no von khong chua — noi dung NGAU NHIEN moi
// mang lai rui ro, va so do khong doi (~100 x 6 592 ky tu).
// Da do thang tren artifact n = 100 that: 100/100 sinh vien sach o CA
// be mat cu LAN be mat rong gap doi. Bao dong gia: 0 -> 0.
// Nguy hiem la 4-6. Tu 7 tro len da an toan (~1 phan 10 000), nen
// nguong dung 7 chu khong phai 8: dat 8 la du mot bac, lam BO SOT
// dang hex tran cua nhung `student_id` co 7 chu so hex.
// Doi 8 -> 7 ngay 2026-08-16 sau khi kiem tren chinh artifact da luu:
// ca hai repo deu 0 lan xuat hien => khong sinh bao dong gia.
// Ha nguong lam phep kiem DO NHIEU HON, tuc chat hon, khong phai long hon.
const MINIMUM_SEARCHABLE_LENGTH = 7;

function hexWithoutPrefix(value: string): string {
    return value.replace(/^0x/i, "");
}

// Mot gia tri co the lo ra duoi nhieu dang ma hoa khac nhau.
function valueEncodings(value: unknown): string[] {
    if (value === null || value === undefined) {
        return [];
    }

    const asText = String(value).trim();

    if (asText === "") {
        return [];
    }

    const encodings = new Set<string>();
    encodings.add(asText);

    let asBigInt: bigint | null = null;

    try {
        asBigInt = /^0x/i.test(asText)
            ? BigInt(asText)
            : BigInt(asText.replace(/[^0-9]/g, "") || "x");
    } catch {
        asBigInt = null;
    }

    if (asBigInt !== null && asBigInt >= 0n) {
        const bare = asBigInt.toString(16);
        const padded = bare.padStart(64, "0");

        encodings.add(asBigInt.toString(10));
        encodings.add(bare);
        encodings.add("0x" + bare);
        encodings.add(padded);
        encodings.add("0x" + padded);
    }

    if (/^(0x)?[0-9a-f]+$/i.test(asText)) {
        encodings.add(hexWithoutPrefix(asText));
    }

    // Hex khong phan biet hoa thuong.
    for (const encoding of Array.from(encodings)) {
        if (/[a-f]/i.test(encoding)) {
            encodings.add(encoding.toLowerCase());
            encodings.add(encoding.toUpperCase());
        }
    }

    return Array.from(encodings);
}

/*
 * ===================================================================
 * NGUONG CO GIAN THEO CO BE MAT (sua 2026-09-05)
 * ===================================================================
 *
 * VAN DE DA GAP THAT. Nguong co dinh 7 duoc chon khi be mat cong khai
 * chi ~28 000 ky tu (ONC, n = 1). Den `n = 500` be mat len
 * 10 928 737 ky tu — gap 390 lan — va mot chuoi hex 7 ky tu trung NGAU
 * NHIEN toi 4,07 %. Luot ONC n = 500 ngay 05/09 bao 18/500 sinh vien bi
 * lo, trong khi ky vong ngau nhien la 20,4 nguoi va `exposedNames` rong
 * => toan bo la BAO DONG GIA.
 *
 * CACH TINH. Mot chuoi hex dai L co 16^L kha nang. Be mat S ky tu cho
 * ~S vi tri de thu, nen so lan trung ky vong ~ S / 16^L. Nhan voi so
 * sinh vien duoc so bao dong gia ky vong cua ca luot chay.
 *
 * CHON NGUONG. Lay L nho nhat sao cho S / 16^L < NGUONG_BAO_GIA.
 * Voi S = 10,9 trieu:  L=7 -> 4,07%   L=8 -> 0,25%   L=9 -> 0,016%
 * Tren 500 sinh vien:  20,4 nguoi     1,27 nguoi     0,08 nguoi
 * => L = 9 la bac dau tien ky vong xuong duoi MOT nguoi.
 *
 * 🔴 KHONG lay L lon hon muc can. Nguong cang cao thi cang BO SOT: chuoi
 * ngan hon nguong khong duoc tim nua, ma ro ri that co the nam o dang
 * ngan. Vi vay lay L NHO NHAT dat yeu cau, khong lam tron len.
 *
 * ⚠️ San tren 7 — giu nguyen muc cu cho be mat nho, de cac luot n = 1
 * van kiem chat y nhu truoc va so cu van so sanh duoc.
 *
 * ⚠️ GIA DINH: ky tu hex trong proof phan bo ngau nhien deu. Voi du lieu
 * proof mat ma thi hop ly. So quan sat (18) khop so du doan (20,4) nen
 * gia dinh nay dung o day.
 */
const NGUONG_BAO_GIA = 0.002;
const NGUONG_SAN = 7;

function nguongTheoCoBeMat(coBeMat: number): number {
    let L = NGUONG_SAN;

    while (L < 32 && coBeMat / Math.pow(16, L) >= NGUONG_BAO_GIA) {
        L += 1;
    }

    return L;
}

function privateWitnessLeakageCheck(
    publicArtifact: any,
    privateValues?: Record<string, unknown>
) {
    const serialized = JSON.stringify(publicArtifact);

    /*
     * Nguong tinh TU CHINH be mat cua luot chay nay, khong lay hang so.
     * Be mat cang lon thi doi chuoi cang dai moi coi la bang chung.
     */
    const nguongToiThieu = nguongTheoCoBeMat(serialized.length);

    const exposedNames = PRIVATE_WITNESS_NAMES.filter(
        (name) => serialized.includes(name)
    );

    const exposedValues: {
        label: string;
        encoding: string;
    }[] = [];
    const skippedTooShort: {
        label: string;
        encoding: string;
    }[] = [];
    let checkedEncodingCount = 0;

    for (const [label, value] of Object.entries(privateValues || {})) {
        for (const encoding of valueEncodings(value)) {
            if (encoding.length < nguongToiThieu) {
                skippedTooShort.push({ label, encoding });
                continue;
            }

            checkedEncodingCount += 1;

            if (serialized.includes(encoding)) {
                exposedValues.push({ label, encoding });
            }
        }
    }

    return {
        passed:
            exposedNames.length === 0
            && exposedValues.length === 0,
        exposedNames,
        exposedValues,
        // Bao cao trung thuc pham vi da kiem, de tai lieu ket qua
        // khong tuyen bo vuot qua thu thuc su duoc kiem.
        coverage: {
            serializedBytes: serialized.length,

            /*
             * Ghi ra nguong DA DUNG va vi sao — de nguoi doc ket qua kiem
             * lai duoc, thay vi phai tin mot hang so an trong code.
             */
            minimumSearchableLength: nguongToiThieu,
            expectedFalseMatchRate:
                (serialized.length / Math.pow(16, nguongToiThieu))
                    .toExponential(2),

            checkedNames: PRIVATE_WITNESS_NAMES,
            checkedEncodingCount,
            skippedTooShort
        }
    };
}

module.exports = {
    privateWitnessLeakageCheck,
    valueEncodings,
    PRIVATE_WITNESS_NAMES
};
