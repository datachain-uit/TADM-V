/*
 * ===================================================================
 * C-7 — SOI ARTIFACT THAT trong `npm test`, khong chi trong runner
 * ===================================================================
 *
 * CHO HO CUA C-7. `00_code_followups.md` giu C-7 o trang thai ☐ voi ly
 * do: *"phan soi artifact that van chi nam trong runner, khong nam
 * trong `npm test`"*. Muoi mot test cu trong `publicSurface.test.ts`
 * deu chay tren OBJECT TONG HOP VIET TAY — chung chung minh phep do
 * biet bat ro ri, nhung khong chung minh BAN CHAY THAT khong ro ri.
 *
 * FILE NAY LAP CHO DO. No mo file ket qua that, lay bi mat that tu
 * `dataset_n*.json`, roi TU DO LAI tren be mat cong khai da luu.
 *
 * VI SAO KHONG CHI DOC LAI `publicSurfaceAudit_K7.allClean`. Doc lai
 * ket luan cua runner thi chi chung minh "runner tu noi no sach" —
 * mot loi trong chinh runner se tu che giau. O day phep do duoc chay
 * LAI mot cach doc lap tu du lieu tho, nen mot loi nhu vay se lo ra.
 *
 * ⚠️ Test bo qua (khong bao loi) neu chua co file ket qua. Ban sao moi
 * clone ve chua chay thuc nghiem thi khong co gi de soi, va bat `npm
 * test` do o do la sai — no khong phai loi cua code.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
    privateWitnessLeakageCheck
} = require("../experiments/publicSurfaceAudit");

const THU_MUC_KET_QUA = path.resolve(
    __dirname,
    "../../../experiments/results/qualitative"
);

const THU_MUC_DATASET = path.resolve(
    __dirname,
    "../../../experiments/data"
);

function artifactMoiNhat(): string | null {
    if (!fs.existsSync(THU_MUC_KET_QUA)) {
        return null;
    }

    const files = fs.readdirSync(THU_MUC_KET_QUA)
        .filter((f: string) => f.endsWith(".json"))
        .map((f: string) => path.join(THU_MUC_KET_QUA, f))
        .sort(
            (a: string, b: string) =>
                fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
        );

    return files.length > 0 ? files[0] : null;
}

function biMatTuDataset(studentCount: number) {
    const duong = path.join(
        THU_MUC_DATASET,
        "dataset_n" + studentCount + ".json"
    );

    if (!fs.existsSync(duong)) {
        return null;
    }

    const dataset = JSON.parse(fs.readFileSync(duong, "utf8"));

    return (dataset.students || []).map(
        (sv: any) => ({
            student_id: sv.student_id,
            rho: sv.note ? sv.note.rho : sv.rho
        })
    );
}

test("C-7 — artifact THAT khong lo private witness (do lai doc lap)", () => {
    const duong = artifactMoiNhat();

    if (!duong) {
        console.error(
            "BO QUA: chua co file ket qua dinh tinh."
            + " Chay `npm run experiment:qualitative` truoc."
        );
        return;
    }

    const artifact = JSON.parse(fs.readFileSync(duong, "utf8"));
    const beMat = artifact?.privacy?.inspectedPublicArtifact;

    assert.ok(
        beMat,
        "artifact phai co `privacy.inspectedPublicArtifact` de soi lai"
    );

    const soSinhVien = Number(artifact?.metadata?.studentCount || 0);
    const biMat = biMatTuDataset(soSinhVien);

    if (!biMat) {
        console.error(
            "BO QUA: khong tim thay dataset_n" + soSinhVien + ".json"
        );
        return;
    }

    /*
     * Soi TUNG sinh vien, khong chi sinh vien dau tien.
     *
     * Mot ro ri co the chi dinh dung mot nguoi — vi du mot ban ghi bi
     * ghi nham vao event. Soi mot nguoi roi ket luan "sach" la dung
     * kieu sai ma phep do sinh ra de bat.
     */
    const nguoiBiLo: number[] = [];

    for (let i = 0; i < biMat.length; i += 1) {
        const ketQua = privateWitnessLeakageCheck(beMat, biMat[i]);

        if (!ketQua.passed) {
            nguoiBiLo.push(i);
        }
    }

    assert.deepEqual(
        nguoiBiLo,
        [],
        "cac sinh vien bi lo tren be mat cong khai: "
        + nguoiBiLo.slice(0, 10).join(", ")
        + " (tong " + nguoiBiLo.length + "/" + biMat.length + ")"
    );
});

test("C-7 — phep do co soi that, khong phai chay rong", () => {
    /*
     * CHOT CHAN. Neu `privateWitnessLeakageCheck` bo qua het moi thu vi
     * chuoi qua ngan, no van tra `passed: true` — va test tren se DAT
     * mot cach gia tao. Kiem rang no thuc su co dem phep do.
     */
    const duong = artifactMoiNhat();

    if (!duong) {
        return;
    }

    const artifact = JSON.parse(fs.readFileSync(duong, "utf8"));
    const beMat = artifact?.privacy?.inspectedPublicArtifact;
    const soSinhVien = Number(artifact?.metadata?.studentCount || 0);
    const biMat = biMatTuDataset(soSinhVien);

    if (!biMat) {
        return;
    }

    const ketQua = privateWitnessLeakageCheck(beMat, biMat[0]);

    assert.ok(
        ketQua.coverage.checkedEncodingCount > 0,
        "khong dem duoc phep do nao - phep kiem dang chay rong"
    );

    assert.ok(
        ketQua.coverage.serializedBytes > 1000,
        "be mat cong khai qua nho (" + ketQua.coverage.serializedBytes
        + " ky tu) - co ve khong phai artifact that"
    );
});

test("C-7 — nhet bi mat vao be mat THAT thi phai bat duoc", () => {
    /*
     * Day moi la thu bien hai test tren tu "khong tim thay gi" thanh
     * "khong co gi de tim". Lay chinh be mat that, nhet mot bi mat vao,
     * roi doi phep do phai bao lo.
     *
     * Khong co test nay thi `passed: true` chi chung minh "may khong
     * tim", chu khong chung minh "khong co gi de tim".
     */
    const duong = artifactMoiNhat();

    if (!duong) {
        return;
    }

    const artifact = JSON.parse(fs.readFileSync(duong, "utf8"));
    const beMat = artifact?.privacy?.inspectedPublicArtifact;
    const soSinhVien = Number(artifact?.metadata?.studentCount || 0);
    const biMat = biMatTuDataset(soSinhVien);

    if (!biMat) {
        return;
    }

    const beMatBanDoc = {
        ...beMat,
        // ten truong vo hai, gia tri thi la bi mat that
        auditTrailReference: String(biMat[0].rho)
    };

    const ketQua = privateWitnessLeakageCheck(beMatBanDoc, biMat[0]);

    assert.equal(
        ketQua.passed,
        false,
        "nhet `rho` vao be mat that ma phep do van bao sach"
        + " - phep do khong dung duoc"
    );
});
