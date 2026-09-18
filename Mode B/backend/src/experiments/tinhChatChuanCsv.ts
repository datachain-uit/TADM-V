/*
 * ===================================================================
 * HAI CSV MINH CHUNG CHO BANG A (MINH BACH) VA BANG B (RIENG TU)
 * ===================================================================
 *
 * VAN DE. Bang A (M1..M4) va bang B (R1..R7) trong `BAO_CAO_DINH_TINH.md`
 * la BANG GO TAY. Nguoi doc khong co cach nao kiem lai tung o, va khong co
 * file nao chep sang `paper/input/results/` de lam minh chung. Ba CSV hien
 * co chi phu 5 TIEU CHI cua outline, khong phu cac DIEU KIEN CHUAN.
 *
 * NAY. Hai file CSV nua, trinh bay giong `-tieuchi.csv`: moi dieu kien mot
 * nhom dong, moi dong mot manh bang chung LAY TU FILE KET QUA, khong go tay.
 *
 * VI SAO DOC TU FILE JSON MA KHONG TINH TRONG RUNNER:
 *   - Sinh lai duoc cho CAC LUOT DA CHAY XONG. Luot `n = 500` mat ~75 phut;
 *     bat runner tinh them nghia la phai chay lai tu dau chi de co CSV.
 *   - Doi cach trinh bay bang thi chi sua file nay, khong dung vao runner
 *     dang la duong chay chinh cua thuc nghiem.
 *
 * ⚠️ GIOI HAN PHAI DOC. Thuc nghiem DINH TINH KHONG do duoc het bang B.
 * `R2` `R3` `R5` thuoc runner AN DANH; o day chung ghi thang
 * `not_measured_here` kem ten runner phai chay. KHONG duoc doc mot o trong
 * ma tuong la dat.
 */

const fs = require("fs");
const path = require("path");

// ------------------------------------------------------------------
// Ket luan — dung chung mot bo tu vung cho ca hai bang.
// ------------------------------------------------------------------

// Dat: he lam duoc dieu chuan doi.
const DAT = "pass";

// Dat mot phan: do duoc mot phan, phan con lai o runner khac / con no.
const DAT_MOT_PHAN = "partial";

// Khong dat CO CHU Y: danh doi da chot, khong dinh sua. Khac han "thieu".
const KHONG_DAT_CO_CHU_Y = "by_design_not_met";

// Phep do nay khong thuoc thuc nghiem dinh tinh.
const DO_O_CHO_KHAC = "not_measured_here";

// Co do, nhung `n` qua nho de ket luan co nghia.
const N_QUA_NHO = "n_too_small";

/*
 * Da BO khoi pham vi bai — khac han "chua do".
 *
 * VI SAO CAN MA RIENG. `not_measured_here` doc ra la "phep do nay o cho
 * khac, sap co". Nhung `R2` `R3` `R5` thi KHONG con nam trong pham vi
 * bai nua (chot 2026-09-05), nen ghi `not_measured_here` khien nguoi
 * doc — va ca agent ben paper — tuong day la viec dang cho lam.
 * Da xay ra that: lo trinh 06/09 bao "R2 tu khai CHUA_TRICH_DUOC, phai
 * bo sung truoc khi dan vao bai", trong khi R2 da bi bo.
 */
const NGOAI_PHAM_VI = "out_of_scope";

const TICK_YES = "✓";
const TICK_NO = "✗";

function laDau(value: unknown): boolean {
    return String(value ?? "").trim().startsWith(TICK_YES);
}

/*
 * ===================================================================
 * CHI GIU DAU — cot `value` phai la GIA TRI, khong phai loi van
 * ===================================================================
 *
 * Artifact luu o dang `"✓ the contract confirms this root was approved
 * earlier, so anyone can check..."` — dau CONG loi giai thich. Loi giai
 * thich la thu MINH VIET, khong phai thu DO DUOC, nen no thuoc cot
 * `meaning`. Cot `value` chi giu `✓` / `✗`.
 *
 * ⚠️ KHONG dung ham nay cho artifact — `M2` dem so o *"co dau kem ly
 * do"* tren chinh artifact, nen phan ly do phai o nguyen trong do.
 * Chi CSV rut gon.
 */
function chiDau(value: unknown): string {
    const s = String(value ?? "").trim();

    if (s.startsWith(TICK_YES)) {
        return TICK_YES;
    }

    if (s.startsWith(TICK_NO)) {
        return TICK_NO;
    }

    return s;
}

/*
 * ===================================================================
 * DOC THANG TU SU KIEN `Withdraw` TREN CHUOI
 * ===================================================================
 *
 * VI SAO CAN. Dieu kien `R1` doi hai lan rut phai "cung thuoc tinh".
 * Cach chung minh manh nhat khong phai mot cau khang dinh, ma la:
 * *dem tren chuoi thay N nguoi nhan KHAC nhau nhung chi MOT muc tien*.
 * Do la con so quan sat vien tu doc duoc, khong phai runner tu khai.
 */
function thongKeWithdraw(artifact: any) {
    const events = artifact?.privacy?.inspectedPublicArtifact?.events;
    const list = Array.isArray(events) ? events : [];

    const withdraws = list.filter((e: any) => e?.event === "Withdraw");
    const mucTien = new Set<string>();
    const nguoiNhan = new Set<string>();

    for (const e of withdraws) {
        const rv = e?.returnValues || {};
        mucTien.add(String(rv.amount ?? ""));
        nguoiNhan.add(String(rv.recipient ?? ""));
    }

    return {
        soLanRut: withdraws.length,
        soNguoiNhan: nguoiNhan.size,
        mucTien: Array.from(mucTien),
        mau: withdraws
            .slice(0, 3)
            .map((e: any) => {
                const rv = e?.returnValues || {};
                return String(rv.recipient ?? "").slice(0, 10)
                    + "... = " + String(rv.amount ?? "");
            })
            .join(" | ")
    };
}

/*
 * ===================================================================
 * KENH THOI GIAN cua `R4` — do tu chinh su kien da luu
 * ===================================================================
 *
 * VI SAO CAN. T5A ghi ve (2) cua `FPR_UNL.1` gom BA kenh:
 * *thoi gian* - *thu tu* - *gop nhieu pool*. Bang `R4` truoc day chi
 * co bang chung cho thu tu; kenh thoi gian moi chi duoc KHANG DINH
 * trong `.md` la *"V2 + onlySchool xu ly"*, khong co so nao.
 *
 * DO THE NAO. Neu thu tu block la mot ham DON DIEU cua thu tu giao
 * dich thi thoi diem tren chuoi khong mang them thong tin nao ngoai
 * THU TU - ma thu tu da bi xao tron. Chi can doc `blockNumber` cua
 * cac su kien `Withdraw` da luu, khong phai chay lai.
 *
 * 🔴 DAY LA KENH VI TRI BLOCK, KHONG PHAI THOI GIAN DONG HO.
 * Artifact khong luu `timestamp` — chi co `blockNumber`. Va du co
 * luu thi tren Ganache no cung vo nghia: timestamp o day phan anh
 * TOC DO VONG LAP CUA RUNNER, khong phai lich giai ngan cua truong.
 * Dung viet "da do kenh thoi gian".
 *
 * ⚠️ Ganache chay INSTAMINE: moi giao dich mot block. Day la tinh
 * chat cua chuoi thu nghiem, khong phai cua he - dung ket luan
 * "he thong tao mot block moi lan rut".
 *
 * 🔵 Nhung huong sai lech la AN TOAN: mot block chua nhieu lan rut
 * thi thoi diem con THO hon, tuc lo IT hon. Instamine la truong hop
 * XAU NHAT cho kenh nay, nen ket luan rut ra o day la ket luan than
 * trong.
 */
function thongKeThoiGian(artifact: any) {
    const events = artifact?.privacy?.inspectedPublicArtifact?.events;
    const list = Array.isArray(events) ? events : [];

    const blocks = list
        .filter((e: any) => e?.event === "Withdraw")
        .map((e: any) => Number(e?.blockNumber));

    const dem = new Map<number, number>();

    for (const b of blocks) {
        dem.set(b, (dem.get(b) || 0) + 1);
    }

    let donDieu = true;

    for (let i = 1; i < blocks.length; i += 1) {
        if (Number(blocks[i]) < Number(blocks[i - 1])) {
            donDieu = false;
        }
    }

    return {
        soLanRut: blocks.length,
        soBlockRieng: dem.size,
        nhieuNhatMoiBlock: dem.size === 0
            ? 0
            : Math.max(...Array.from(dem.values())),
        donDieu
    };
}

function csvCell(value: unknown): string {
    const text = String(value ?? "")
        .replace(/\r?\n/g, " ")
        .trim();

    return /[",;]/.test(text)
        ? "\"" + text.replace(/"/g, "\"\"") + "\""
        : text;
}

function csvTable(header: string[], rows: string[][]): string {
    return [header, ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n") + "\r\n";
}

/*
 * ===================================================================
 * NGUON CHUAN — dinh danh ben, dung chung cho ca hai bang
 * ===================================================================
 *
 * VI SAO TACH RA HANG SO: moi dieu kien phai chi duoc ra ban goc nao,
 * muc nao, cau nao. Viet lai chuoi o tung cho thi som muon se lech nhau
 * giua cac dong, va nguoi phan bien doi chieu se thay bai trich khong
 * nhat quan.
 */
const CC = "ISO/IEC 15408-2 (Common Criteria) CC:2022 Release 1";
/*
 * 🔴 SUA 2026-09-14 — chuoi nay tung ghi TIENG VIET ("ban PDF 297 trang").
 * No di thang vao cot `standard_ref` cua CSV, ma CSV la thu nguoi viet bai
 * chep sang phan tai lieu tham khao. Gop y cua co 14/09 bat duoc reference
 * [4] con dong tieng Viet. Nguon chuan phai la tieng Anh.
 */
const CC_REF = "commoncriteriaportal.org, 297-page PDF";

const NIST = "NIST IR 8202 - Blockchain Technology Overview";
const NIST_REF = "DOI 10.6028/NIST.IR.8202";

const RFC = "RFC 6973 - Privacy Considerations for Internet Protocols";
const RFC_REF = "DOI 10.17487/RFC6973";

/*
 * Trang thai cua cau trich — CHUYEN NAY QUAN TRONG HON VE NGOAI.
 *
 * `verbatim` = cau da doi chieu voi ban goc va chep NGUYEN VAN.
 * `CHUA_TRICH_DUOC` = chua co cau nguyen van nao duoc kiem cho dieu kien
 *   nay; o cot `standard_quote` de trong CO CHU Y.
 *
 * 🔴 Khong duoc dien mot cau "nghe hop ly" vao o trong. Mot cau trich sai
 * nguon lam nguoi phan bien mat long tin vao MOI con so khac trong bai —
 * de trong thi chi mat mot dong.
 */
const VERBATIM = "verbatim";
const CHUA_TRICH = "CHUA_TRICH_DUOC - phai bo sung truoc khi dan vao bai";

const HEADER = [
    "branch",
    "run_at",
    "git_commit",
    "chain_id",
    "condition",
    "condition_name",
    "standard_id",
    "standard_ref",
    "standard_clause",
    "standard_quote",
    "quote_status",
    "verdict",
    "evidence_name",
    "value",
    "meaning"
];

type Dong = {
    dieuKien: string;
    ten: string;
    chuan: string;
    chuanRef: string;
    muc: string;
    trichDan: string;
    trangThaiTrich: string;
    ketLuan: string;
    bangChung: [string, unknown, string][];
};

/*
 * Dem so o bang chung duoc ghi dang "dau tick + ly do".
 *
 * DAY LA BANG CHUNG CHO `M2`. `FAU_SAR.1.2` khong doi "doc duoc" ma doi
 * "o dang nguoi doc DIEN GIAI duoc". Mot o ghi `false` tran thi doc duoc
 * nhung khong dien giai duoc. Nen so o co ly do di kem chinh la thu do
 * duoc cua dieu kien nay — khong phai mot con so trang tri.
 */
function demOCoLyDo(criteria: any): { coLyDo: number; tong: number; viDu: string } {
    let coLyDo = 0;
    let tong = 0;
    let viDu = "";

    for (const key of Object.keys(criteria || {})) {
        const evidence = criteria[key]?.evidence || {};

        for (const ten of Object.keys(evidence)) {
            const gia = String(evidence[ten] ?? "");
            tong += 1;

            if (gia.startsWith(TICK_YES) || gia.startsWith("✗")) {
                coLyDo += 1;

                if (!viDu) {
                    viDu = ten + " = " + gia;
                }
            }
        }
    }

    return { coLyDo, tong, viDu };
}

/*
 * So commitment trong root da cong bo = CAN TREN cua tap an danh.
 *
 * VI SAO lay tu su kien chu khong lay `metadata.studentCount`:
 * `studentCount` la thu runner TU KHAI. So commitment trong
 * `CommitmentsPublished` la thu NGUOI NGOAI doc duoc tu chuoi. Bang B noi
 * ve cai quan sat vien thay, nen phai lay con so quan sat vien co.
 */
function demCommitmentTrenChuoi(artifact: any): number | null {
    const events = artifact?.withdrawal?.events || [];

    for (const e of events) {
        if (e?.event === "CommitmentsPublished") {
            const arr = e?.returnValues?.commitments;

            if (Array.isArray(arr)) {
                return arr.length;
            }
        }
    }

    return null;
}

function truongCuaSuKienWithdraw(artifact: any): string {
    const events = artifact?.withdrawal?.events || [];

    for (const e of events) {
        if (e?.event === "Withdraw") {
            return Object.keys(e?.returnValues || {})
                .filter((k) => !/^\d+$/.test(k) && k !== "__length__")
                .join(" | ");
        }
    }

    return "(khong tim thay su kien Withdraw)";
}


/*
 * ===================================================================
 * DOC KET QUA THUC NGHIEM AN DANH (them 2026-09-02)
 * ===================================================================
 *
 * VI SAO. `R2` `R3` `R5` va HAI TRONG BON kenh cua `R4` KHONG do duoc
 * bang luot dinh tinh — chung thuoc runner an danh, ghi ra mot thu muc
 * khac. Truoc thay doi nay, chay xong runner an danh thi
 * `-B-riengtu.csv` VAN ghi `not_measured_here` mai mai, vi module chi
 * doc file JSON cua dinh tinh.
 *
 * Nay: tim `experiments/results/anonymity/anonymity_summary.json` ben
 * canh. Khong co thi giu nguyen `not_measured_here` — dung, vi luc do
 * that su chua do.
 *
 * 🔴 CHOT CHAN QUAN TRONG: so sanh THOI DIEM hai luot chay. Ket qua an
 * danh CU HON luot dinh tinh nghia la no do tren mot ban code khac —
 * dan vao bai la tron so cua hai phien ban. Truong hop nay co that:
 * ban tom tat 26/08 co truoc toan bo A20..A25.
 */
function docKetQuaAnDanh(jsonPath: string, artifact: any) {
    const duong = path.resolve(
        path.dirname(jsonPath),
        "../anonymity/anonymity_summary.json"
    );

    if (!fs.existsSync(duong)) {
        return null;
    }

    let d: any;

    try {
        d = JSON.parse(fs.readFileSync(duong, "utf8"));
    } catch {
        return null;
    }

    const ketQua = Array.isArray(d?.results) ? d.results : [];

    if (ketQua.length === 0) {
        return null;
    }

    /*
     * Chi lay kich ban CUNG MENH GIA — do la thiet ke da chot cua he.
     * Kich ban khac menh gia la DOI CHUNG, dua vao day se lam hong ket
     * luan (no CO Y de tap an danh co lai).
     */
    const cungTien = ketQua.filter((x: any) => x?.sameAmount === true);
    const dung = cungTien.length > 0 ? cungTien : ketQua;

    const nLonNhat = dung.reduce(
        (a: any, b: any) => (Number(b?.n) > Number(a?.n) ? b : a),
        dung[0]
    );

    const tongMau = dung.reduce(
        (t: number, x: any) => t + Number(x?.totalWithdrawals || 0),
        0
    );

    const chayLuc = String(d?.metadata?.finishedAt || d?.metadata?.startedAt || "");
    const dinhTinhLuc = String(
        artifact?.metadata?.finishedAt || artifact?.metadata?.startedAt || ""
    );

    const cuHon = Boolean(
        chayLuc && dinhTinhLuc && new Date(chayLuc) < new Date(dinhTinhLuc)
    );

    // Cac truong cua V2 / C-13 chi co neu da chay ban runner tu A20.
    const coCauKet = dung.some(
        (x: any) => x?.anonymitySetUnderFullCollusion !== undefined
    );
    const coThuTu = dung.some(
        (x: any) => x?.accuracyByOrder !== undefined
    );

    return {
        duong,
        chayLuc,
        cuHon,
        soKichBan: dung.length,
        tongMau,
        nLonNhat: Number(nLonNhat?.n),
        accuracyByAmount: nLonNhat?.accuracyByAmount,
        correctGuesses: nLonNhat?.correctGuessesByAmount,
        totalWithdrawals: nLonNhat?.totalWithdrawals,
        meanAnonymitySet: nLonNhat?.meanAnonymitySetByAmount,
        coCauKet,
        coThuTu,
        anonymitySetUnderFullCollusion: nLonNhat?.anonymitySetUnderFullCollusion,
        colludersNeededToDeanonymize: nLonNhat?.colludersNeededToDeanonymize,
        accuracyByOrder: nLonNhat?.accuracyByOrder,
        shuffleWithdrawOrder: nLonNhat?.shuffleWithdrawOrder
    };
}

// ------------------------------------------------------------------
// A · MINH BACH
// ------------------------------------------------------------------

/*
 * ===================================================================
 * `M4` — LAY KET QUA DUNG LAI CAY
 * ===================================================================
 *
 * Uu tien khoi `rootRebuildCheck_M4` do RUNNER ghi (tu 12/09). Cac luot
 * chay TRUOC do khong co khoi nay — luc do ta TU dung lai ngay tai day:
 * lay commitment tu su kien da luu, goi mode `root` cua prover, so voi
 * `currentRoot`.
 *
 * 🔵 Lam duoc nhu vay CHINH XAC vi `M4` noi ve nguoi NGOAI: mot nguoi
 * ngoai luon dung lai cay SAU khi du lieu da len chuoi, tu du lieu cong
 * khai. Nen dung lai tu artifact khong phai "suy ra" — no la dung mo
 * hinh nguoi ngoai.
 *
 * ⚠️ Bo qua lang le neu thieu prover: sinh CSV khong duoc chet vi mot o.
 */
function layKiemDungLaiGoc(artifact: any) {
    const daCo = artifact?.rootRebuildCheck_M4;

    if (daCo && daCo.rebuiltRoot) {
        return {
            leafCount: Number(daCo.leafCount || 0),
            rebuiltRoot: String(daCo.rebuiltRoot),
            onChainRoot: String(daCo.onChainRoot || ""),
            matches: daCo.rebuiltRootMatchesOnChain === true,
            nguon: "runner, in this run"
        };
    }

    const beMat = artifact?.privacy?.inspectedPublicArtifact;
    const events = Array.isArray(beMat?.events) ? beMat.events : [];

    const congBo = events.filter(
        (e: any) => e?.event === "CommitmentsPublished"
    );

    if (congBo.length === 0) {
        return null;
    }

    const camKet = (
        (congBo[0]?.returnValues || {}).commitments || []
    ).map((x: any) => String(x));

    if (camKet.length === 0) {
        return null;
    }

    try {
        const { spawnSync } = require("child_process");

        const goc = path.resolve(__dirname, "../../..");
        const binary = path.join(
            goc,
            "target",
            "release",
            process.platform === "win32" ? "prover.exe" : "prover"
        );

        if (!fs.existsSync(binary)) {
            return null;
        }

        const kq = spawnSync(binary, ["root"], {
            cwd: path.join(goc, "backend"),
            input: JSON.stringify({ commitments: camKet }),
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024
        });

        if (kq.status !== 0) {
            return null;
        }

        const dong = String(kq.stdout || "")
            .split(/\r?\n/)
            .map((x: string) => x.trim())
            .filter(Boolean);

        let ra: any = null;

        for (let i = dong.length - 1; i >= 0; i -= 1) {
            try {
                ra = JSON.parse(String(dong[i]));
                break;
            } catch (_) {
                // prover co the in tien do truoc dong JSON cuoi
            }
        }

        if (!ra || !ra.root) {
            return null;
        }

        const trenChuoi = String(
            beMat?.contractState?.currentRoot || ""
        ).toLowerCase();

        return {
            leafCount: camKet.length,
            rebuiltRoot: String(ra.root),
            onChainRoot: String(beMat?.contractState?.currentRoot || ""),
            matches: String(ra.root).toLowerCase() === trenChuoi,
            nguon: "rebuilt here from the saved event log"
        };
    } catch (_) {
        return null;
    }
}

/*
 * 🔴 SUA 2026-09-14 — `ten` va `muc` cua cac dieu kien DUOC XUAT RA CSV nay
 * la TIENG ANH. Hai cot `condition_name` / `standard_clause` la thu nguoi
 * viet bai chep thang sang bang va tai lieu tham khao; ban cu ghi
 * "muc 8.5.8", "trang 18", "NOTE duoi" — dung kieu chu da lot vao
 * reference [4] ma co bat duoc. Cot `meaning` van tieng Viet: no la chu
 * thich cho nguoi doc CSV, khong di vao bai.
 */
function dungBangA(artifact: any): Dong[] {
    const c = artifact?.qualitativeCriteria_2_1_3 || {};
    const e2a = c["2a_state_readable"]?.evidence || {};
    const e2b = c["2b_state_verifiable"]?.evidence || {};
    const dem = demOCoLyDo(c);
    const soCommitment = demCommitmentTrenChuoi(artifact);

    const m3Dat = laDau(e2b.proofVerifiedOnChain);
    const dungLai = layKiemDungLaiGoc(artifact);

    /*
     * 🔴 SUA 2026-09-12. Truoc day `m4Dat` dua tren
     * `rootReconstructibleByThirdParty`, ma o do lai chi la phep dò TEN
     * tham so trong ABI. Nay `M4` chi `pass` khi cay THAT SU dung lai
     * duoc va ra dung goc tren chuoi.
     */
    const m4Dat = laDau(e2b.commitmentPublishedOnChain)
        && dungLai?.matches === true;

    return [
        {
            dieuKien: "M1",
            ten: "State readability",
            chuan: CC,
            chuanRef: CC_REF,
            muc: "Sect. 8.5.8, FAU_SAR.1.1 (Audit review)",
            trichDan: "provide ... the capability to read ... from the audit data",
            trangThaiTrich: VERBATIM,
            ketLuan: c["2a_state_readable"]?.verdict === DAT ? DAT : DAT_MOT_PHAN,
            bangChung: [
                ["currentRoot", e2a.currentRoot,
                    "root hien tai doc thang tu contract"],
                ["validRoot", chiDau(e2a.validRoot),
                    "contract tu xac nhan root nay da duoc duyet"],
                ["usedNullifier", chiDau(e2a.usedNullifier),
                    "contract tu bao nullifier nay da tieu"],
                ["contractEvents", e2a.contractEvents,
                    "chuoi su kien nguoi ngoai doc duoc"],
                ["transactionHash", e2a.transactionHash,
                    "giao dich rut - tra nguoc duoc tren explorer"]
            ]
        },
        {
            dieuKien: "M2",
            ten: "Interpretable presentation",
            chuan: CC,
            chuanRef: CC_REF,
            muc: "Sect. 8.5.8, FAU_SAR.1.2 (Audit review)",
            trichDan: "provide the audit data in a manner suitable for the user to"
                + " interpret the information",
            trangThaiTrich: VERBATIM,
            ketLuan: dem.coLyDo > 0 ? DAT : DAT_MOT_PHAN,
            bangChung: [
                ["evidenceCellsWithReason", dem.coLyDo + " / " + dem.tong,
                    "so o bang chung ghi dang dau tick KEM LY DO, khong phai true/false tran"],
                ["example", dem.viDu,
                    "mot o lam vi du - doc la hieu, khong phai tra bang"]
            ]
        },
        {
            dieuKien: "M3",
            ten: "No trusted third party",
            chuan: NIST,
            chuanRef: NIST_REF,
            muc: "Sect. 4 (Consensus Models), p. 18",
            trichDan: "there is no need to have a trusted third party provide the"
                + " state of the system - every user within the system can verify"
                + " the system's integrity",
            trangThaiTrich: VERBATIM,
            ketLuan: m3Dat ? DAT : KHONG_DAT_CO_CHU_Y,
            /*
             * 06/09: bo `residualTrust` va `tradeOffNote` khoi CSV —
             * ca hai la LOI VAN, khong phai gia tri do duoc. Danh doi
             * cua nhanh off-chain ghi o `BAO_CAO_DINH_TINH.md`.
             */
            bangChung: [
                ["proofVerifiedOnChain", chiDau(e2b.proofVerifiedOnChain),
                    "hop dong co tu kiem proof khong - doc tu ABI ham withdraw"],
                ["verifiedBy", e2b.verifiedBy,
                    "ai la ben thuc su kiem proof"],
                ["verifiableAxesPassed", e2b.verifiableAxesPassed,
                    "so truc kiem chung dat: A = proof kiem lai duoc, B = root dung lai duoc"]
            ]
        },
        {
            dieuKien: "M4",
            ten: "Independent state agreement",
            chuan: NIST,
            chuanRef: NIST_REF,
            muc: "Sect. 4 (Consensus Models), p. 18",
            trichDan: "By combining the initial state and the ability to verify every"
                + " block since then, users can independently agree on the current"
                + " state of the blockchain",
            trangThaiTrich: VERBATIM,
            ketLuan: m4Dat ? DAT : DAT_MOT_PHAN,
            bangChung: [
                ["commitmentPublishedOnChain", chiDau(e2b.commitmentPublishedOnChain),
                    "tap commitment co len chuoi khong"],
                ["rootRebuiltFromChainData",
                    dungLai
                        ? (dungLai.matches ? TICK_YES : TICK_NO)
                        : "(luot nay khong dung lai)",
                    "DA dung lai cay tu commitment tren chuoi va so voi `currentRoot`"
                    + " - khong phai chi do ten tham so trong ABI"],
                ["rebuiltRoot",
                    dungLai ? dungLai.rebuiltRoot : "(khong co)",
                    "goc bam lai tu " + String(dungLai?.leafCount ?? 0)
                    + " commitment, bang mode `root` cua prover"],
                ["rebuildMeasuredBy",
                    dungLai ? dungLai.nguon : "(khong co)",
                    "runner tu do luc chay, hay dung lai tu log da luu"],
                ["rootPublishingEvents", e2b.rootPublishingEvents,
                    "su kien nao mang du lieu de dung lai cay"],
                ["commitmentsInPublishedRoot",
                    soCommitment === null ? "(khong co su kien CommitmentsPublished)" : soCommitment,
                    "so la trong root - DEM TU SU KIEN tren chuoi, khong lay tu bao cao cua runner"],
                ["currentRoot", e2a.currentRoot,
                    "root de doi chieu sau khi dung lai cay tu tap commitment tren"]
            ]
        }
    ];
}

// ------------------------------------------------------------------
// B · BAO VE QUYEN RIENG TU
// ------------------------------------------------------------------

function dungBangB(artifact: any, anDanh: any): Dong[] {
    const c = artifact?.qualitativeCriteria_2_1_3 || {};
    const c4 = c["4_private_witness"] || {};
    const e4 = c4.evidence || {};
    const audit = artifact?.publicSurfaceAudit_K7 || {};
    const soCommitment = demCommitmentTrenChuoi(artifact);
    const wd = thongKeWithdraw(artifact);
    /*
     * 🔴 UU TIEN SO DO RUNNER GHI (tu 2026-09-10).
     *
     * Tu luot chay 10/09 tro di, runner TU DO kenh vi + kenh vi tri
     * block ngay trong luot va ghi vao `linkabilityChannels_R4`. Doc
     * thang khoi do la dung nhat: no la ket qua CUA phep do, khong phai
     * thu suy ra sau.
     *
     * Cac luot TRUOC do khong co khoi nay — luc do suy lai tu su kien
     * da luu (`thongKeThoiGian`). Van dung, nhung yeu hon mot bac, nen
     * o `measuredBy` khai ro lay tu dau.
     */
    const kenhRunner = artifact?.linkabilityChannels_R4;
    const tg = thongKeThoiGian(artifact);

    /*
     * Kenh VI: mot dia chi nhan tien hai lan thi ghep duoc hai lan rut
     * ve cung mot nguoi. Do THANG tren chuoi — so nguoi nhan rieng biet
     * bang so lan rut nghia la khong ai nhan hai lan.
     *
     * ⚠️ Day la phep do TRONG MOT POOL. Chan VINH VIEN giua nhieu pool
     * la rang buoc A21 o tang CSDL, chung minh boi test chu khong boi
     * luot chay nay — dung doc o nay thanh ca hai.
     */
    const viKhongDungLai = wd.soLanRut > 0
        && wd.soNguoiNhan === wd.soLanRut;
    const truongWithdraw = truongCuaSuKienWithdraw(artifact);

    /*
     * V1(b) — menh gia hop dong DANG cuong che, doc nguoc tu chuoi.
     * `null` = luot chay cu, truoc khi runner ghi truong nay.
     */
    const denomRaw = artifact?.privacy?.inspectedPublicArtifact
        ?.contractState?.denomination;
    const denom = denomRaw === undefined || denomRaw === null
        ? null
        : String(denomRaw);
    const cuongCheMenhGia = denom !== null && denom !== "0";

    /*
     * Chấm `R1` theo DUNG hai ve cua dinh nghia RFC 6973 muc 3.3:
     *   ve 1 — co tap: `soCommitment` la CAN TREN, doc tu chuoi.
     *   ve 2 — "same attributes": hop dong co cuong che mot menh gia khong.
     *
     * Du ca hai ve moi `pass`. Thieu ve 2 thi `partial` — vi luc do dieu
     * kien cung menh gia chi dat NHO DU LIEU tinh co dong nhat, khong co gi
     * trong he ngan mot lan trien khai cap moi nguoi mot muc.
     */
    /*
     * Kenh THU TU cua `R4` — doc tu chinh artifact (them 2026-09-05).
     * `matchingPositions` ~ 1 nghia la xao tron da cat duong noi giua
     * thu tu nop don va thu tu tren chuoi.
     */
    const thuTu = artifact?.withdrawOrderChannel_R4;
    const kenhThuTuDong = Boolean(
        thuTu
        && thuTu.verdict === DAT
    );

    /*
     * 🔴 SUA 2026-09-06. Voi `n = 1` chi co MOT lan rut, khong co thu tu
     * nao de xao tron: `withdrawalsCompared = 0`. Ban truoc van in
     * *"DA DONG - ... 0/0 vi tri trung"* — ket luan "da dong" rut ra tu
     * KHONG phep so sanh nao. Cung ho lỗi voi `residualTrust` (A30):
     * cau van khong nhin cung mot dieu kien voi verdict.
     */
    const thuTuDoDuoc = Boolean(
        thuTu
        && Number(thuTu.withdrawalsCompared ?? 0) >= 2
    );

    const r1KetLuan = soCommitment === null
        ? DO_O_CHO_KHAC
        : soCommitment <= 1
            ? N_QUA_NHO
            : cuongCheMenhGia
                ? DAT
                : DAT_MOT_PHAN;

    return [
        {
            dieuKien: "R1",
            ten: "Anonymity set",
            chuan: RFC,
            chuanRef: RFC_REF,
            muc: "Sect. 3.3 (Terminology), definition of \"Anonymity set\"",
            trichDan: "A set of individuals that have the same attributes, making them"
                + " indistinguishable from each other from the perspective of a"
                + " particular attacker or observer",
            trangThaiTrich: VERBATIM,
            ketLuan: r1KetLuan,
            /*
             * 06/09: moi o duoi day la MOT CON SO doc tu chuoi.
             * Hai o cu (`observableAttribute`, `equalAmountComesFrom`)
             * la loi van dien giai — da chuyen sang `BAO_CAO_DINH_TINH.md`.
             *
             * Ba o giua moi la cot song cua `R1`: N nguoi nhan KHAC nhau
             * ma chi MOT muc tien ⇒ dung nghia "same attributes, making
             * them indistinguishable".
             */
            bangChung: [
                ["anonymitySetFromChain",
                    soCommitment === null ? "(khong do duoc)" : soCommitment,
                    "so la trong root da cong bo = CAN TREN cua tap an danh, dem tu su kien chu khong tu runner"],
                ["withdrawEventsObserved", wd.soLanRut,
                    "so su kien Withdraw dem duoc tren chuoi"],
                ["distinctRecipients", wd.soNguoiNhan,
                    "so dia chi nhan KHAC NHAU trong so su kien do"],
                ["distinctAmounts",
                    wd.mucTien.length + " (" + wd.mucTien.join(" | ") + ")",
                    "so MUC TIEN khac nhau. Bang 1 nghia la so tien khong phan biet duoc ai voi ai"],
                ["withdrawSample", wd.mau,
                    "ba su kien dau: dia chi nhan = so tien. Doi chieu tay duoc"],
                ["denominationFromContract",
                    denom === null ? "(luot chay nay khong ghi lai)" : denom,
                    "muc tien hop dong bat buoc, doc NGUOC tu ham `denomination()`."
                    + " Khac 0 nghia la hop dong TU CHOI moi lan nop sai muc"]
            ]
        },
        {
            dieuKien: "R2",
            ten: "An danh - do ti le anh xa dung sinh vien <-> lan rut",
            chuan: RFC,
            chuanRef: RFC_REF,
            muc: "muc 3.3 (Terminology), dinh nghia \"Anonymity\"",
            trichDan: "",
            trangThaiTrich: NGOAI_PHAM_VI,
            ketLuan: NGOAI_PHAM_VI,
            bangChung: [
                ["reason",
                    "trung noi dung voi R1 - ca hai cung tra loi \"co chi duoc ai khong\","
                    + " nhung R2 dua tren 3 mau con R1 dua tren co tap 500, tat dinh",
                    "da bo khoi pham vi bai 2026-09-05"],
                ["scopeNote",
                    "bo dieu kien rieng tu chot lai con BON: R1 R4 R6 R7",
                    "KHONG phai viec dang cho lam - dung doc o trong nhu la thieu sot"]
            ]
        },
        {
            dieuKien: "R3",
            ten: "Khong lien ket duoc - VE XAC SUAT",
            chuan: RFC,
            chuanRef: RFC_REF,
            muc: "muc 3.3 (Terminology), dinh nghia \"Unlinkability\"",
            trichDan: "Within a particular set of information, the inability of an"
                + " observer or attacker to distinguish whether two items of interest"
                + " are related or not (with a high enough degree of probability to be"
                + " useful to the observer or attacker)",
            trangThaiTrich: VERBATIM,
            ketLuan: NGOAI_PHAM_VI,
            bangChung: [
                ["reason",
                    "chua chot duoc nguong tham chieu p0; va o n = 500 can 1 497 mau,"
                    + " nhieu hon so sinh vien co trong pool nen khong thuc hien duoc",
                    "da bo khoi pham vi bai 2026-09-05"],
                ["scopeNote",
                    "cam viet bat ky cau nao co chu \"voi xac suat\" ve unlinkability",
                    "xem muc Gioi han trong bai"]
            ]
        },
        {
            dieuKien: "R4",
            ten: "Unlinkability (FPR_UNL.1) - four channels: amount, wallet, payout order, block position",
            chuan: CC,
            chuanRef: CC_REF,
            muc: "Sect. 14.4.5, NOTE under FPR_UNL.1.1 (Unlinkability)",
            trichDan: "This SFR intends to look at a chain of interlinked operations by"
                + " multiple entities. This chain can be subsumed as a transaction",
            trangThaiTrich: VERBATIM,
            /*
             * Cham tren BA kenh DOC LAP do duoc: `amount` · vi · thu tu.
             *
             * 🔴 SUA 2026-09-10. Ban truoc cham tren HAI bien nhung TEN
             * dieu kien lai ghi "ba kenh", va kenh VI khong co o bang
             * chung nao — nhan dem mot dang, bang chung mot neo. Cung ho
             * loi voi `residualTrust` (A30).
             *
             * Kenh THOI GIAN khong vao cong thuc nay, CO Y: no khong doc
             * lap. Thoi diem tren chuoi chi mang thong tin ve THU TU, ma
             * thu tu da cham o tren. Dua vao day la dem mot phep do hai
             * lan. Bang chung cua no van ghi ra de nguoi doc tu kiem.
             *
             * Kenh CAU KET da bo khoi pham vi cung voi `R5` (2026-09-05).
             */
            ketLuan: cuongCheMenhGia && kenhThuTuDong && viKhongDungLai
                ? DAT
                : thuTuDoDuoc
                    ? DAT_MOT_PHAN
                    // Khong do duoc vi n qua nho — khac "do roi khong dat".
                    : N_QUA_NHO,
            /*
             * Moi o la MOT SO doc tu chuoi — khong ghi cau "DA DONG /
             * CON HO" nua. Nguoi doc tu ket luan tu con so; ket luan cua
             * runner nam o cot `verdict`, khong lap lai trong tung o.
             */
            bangChung: [
                ["denominationFromContract",
                    denom === null ? "(luot chay nay khong ghi lai)" : denom,
                    "kenh 1 - so tien. Hop dong bat buoc dung muc nay, doc nguoc bang `denomination()`"],
                ["distinctAmounts",
                    wd.mucTien.length + " (" + wd.mucTien.join(" | ") + ")",
                    "kenh 1 - so muc tien khac nhau tren chuoi. Bang 1 la kenh nay khong con phan biet duoc ai"],
                ["measuredBy",
                    kenhRunner
                        ? "runner, in this run"
                        : "re-derived from the saved event log",
                    "nguon cua ba o duoi: runner tu do luc chay, hay suy lai tu log da luu"],
                ["walletReuseObserved",
                    kenhRunner
                        ? kenhRunner.walletReuseObserved
                        : wd.soLanRut - wd.soNguoiNhan,
                    "kenh 2 - so lan MOT dia chi nhan tien hai lan tro len."
                    + " Bang 0 la khong ghep duoc hai lan rut qua vi."
                    + " Chan o tang CSDL bang A21, kiem boi poolAndWalletConstraints.test.ts"],
                ["shuffleSeed",
                    thuTu ? thuTu.shuffleSeed : "(khong co)",
                    "kenh 3 - hat giong xao tron. Ghi lai de luot chay LAP LAI duoc"],
                ["withdrawalsCompared",
                    thuTu ? thuTu.withdrawalsCompared : 0,
                    "kenh 3 - so lan rut duoc doi chieu vi tri nop don voi vi tri tren chuoi"],
                ["matchingPositions",
                    thuTu ? thuTu.matchingPositions : "(khong do duoc)",
                    "kenh 3 - so vi tri TRUNG nhau. Bang so lan rut la lo nguyen thu tu"],
                ["expectedIfRandom",
                    thuTu ? thuTu.expectedIfRandom : "(khong do duoc)",
                    "kenh 3 - ky vong ly thuyet neu thu tu la ngau nhien: diem bat dong cua hoan vi ngau nhien = 1"],
                ["orderSample",
                    (thuTu?.sample || [])
                        .slice(0, 3)
                        .map((x: any) =>
                            String(x.studentId) + ": " + String(x.viTriNop)
                            + " -> " + String(x.viTriChuoi))
                        .join(" | "),
                    "kenh 3 - ba dong dau: ma sinh vien, vi tri nop don, vi tri tren chuoi"],
                ["chainCrossCheckAgrees",
                    thuTu?.crossCheckFromChain
                        ? (thuTu.crossCheckFromChain.agreesWithRunnerBookkeeping
                            ? TICK_YES : TICK_NO)
                        : "(luot nay khong co doi chung)",
                    "kenh 3 - dem LAI `matchingPositions` tu su kien tren chuoi."
                    + " ✓ nghia la so sach runner khop chuoi;"
                    + " ✗ la phat hien that, phai dieu tra"],
                ["maxWithdrawalsPerBlock",
                    kenhRunner
                        ? kenhRunner.maxWithdrawalsPerBlock
                        : (tg.soLanRut === 0 ? "(khong do duoc)" : tg.nhieuNhatMoiBlock),
                    "kenh 4 - nhieu nhat bao nhieu lan rut trong CUNG mot block."
                    + " Bang 1 la truong hop LO NHIEU NHAT cua kenh nay"],
                ["distinctBlocks",
                    kenhRunner
                        ? kenhRunner.distinctBlocks + " / "
                            + kenhRunner.withdrawEventsObserved
                        : (tg.soLanRut === 0
                            ? "(khong do duoc)"
                            : tg.soBlockRieng + " / " + tg.soLanRut),
                    "kenh 4 - so block rieng biet tren so lan rut"],
                ["blockOrderMatchesChainOrder",
                    kenhRunner
                        ? (kenhRunner.blockOrderMatchesChainOrder
                            ? TICK_YES : TICK_NO)
                        : (tg.soLanRut === 0
                            ? "(khong do duoc)"
                            : (tg.donDieu ? TICK_YES : TICK_NO)),
                    "kenh 4 - thu tu block co don dieu theo thu tu giao dich khong."
                    + " Dung nghia la VI TRI BLOCK khong mang them thong tin nao ngoai thu tu."
                    + " KHONG phai phep do thoi gian dong ho: artifact khong luu timestamp,"
                    + " va tren chuoi thu nghiem timestamp chi phan anh toc do vong lap runner"]
            ]
        },
        {
            dieuKien: "R5",
            ten: "Chong cau ket giua nhung nguoi dung",
            chuan: CC,
            chuanRef: CC_REF,
            muc: "Annex I.4.2.2, EXAMPLE 1 (rang buoc phu cua FPR_UNL.1)",
            trichDan: "...the TSF must not only provide protection against each"
                + " individual user or subject but must protect with respect to"
                + " cooperating users and/or subjects",
            trangThaiTrich: VERBATIM,
            ketLuan: NGOAI_PHAM_VI,
            bangChung: [
                ["reason",
                    "la EXAMPLE trong phu luc CC, khong phai yeu cau chinh; va voi"
                    + " 3 nguoi rut thi tap chi co tu 500 xuong 498 - gan nhu vo nghia",
                    "da bo khoi pham vi bai 2026-09-05"],
                ["scopeNote",
                    "kenh cau ket cua R4 cung bo theo - hai thu la CUNG MOT phep do",
                    "xem muc Gioi han trong bai"]
            ]
        },
        {
            dieuKien: "R6",
            ten: "Anonymity of student identity (FPR_ANO.1)",
            chuan: CC,
            chuanRef: CC_REF,
            muc: "Sect. 14.2.5 FPR_ANO.1; family behaviour in Sect. 14.2.1",
            trichDan: "anonymity ... is not intended to protect the subject identity",
            trangThaiTrich: VERBATIM,
            ketLuan: audit.allClean === true ? DAT : DAT_MOT_PHAN,
            bangChung: [
                ["studentsAudited", audit.studentsAudited,
                    "so sinh vien duoc soi bang chung"],
                ["studentsLeaked", audit.studentsLeaked,
                    "so sinh vien bi lo dinh danh tren be mat cong khai"],
                ["totalEncodingsChecked", audit.totalEncodingsChecked,
                    "so cach ma hoa da thu cho moi gia tri bi mat"],
                ["student_id_traces", e4.student_id_traces,
                    "vet cua ma sinh vien tren be mat cong khai - rong la dat"],
                ["publicSurfacesAudited", e4.publicSurfacesAudited,
                    "nhung be mat da soi"],
                ["surfaceSizeChars",
                    artifact?.privacy?.coverage?.serializedBytes ?? "(khong ghi lai)",
                    "co be mat cong khai da soi, tinh bang ky tu"],
                ["minimumSearchableLength",
                    artifact?.privacy?.coverage?.minimumSearchableLength ?? "(khong ghi lai)",
                    "do dai chuoi hex ngan nhat con dam bao do duoc, TINH TU co be mat tren"],
                ["expectedFalseMatchRate",
                    artifact?.privacy?.coverage?.expectedFalseMatchRate ?? "(khong ghi lai)",
                    "ti le trung ngau nhien ky vong o nguong do dai tren - de biet 0 ro ri co nghia"]
            ]
        },
        {
            dieuKien: "R7",
            ten: "Unobservability (FPR_UNO.1)",
            chuan: CC,
            chuanRef: CC_REF,
            muc: "Sect. 14.5.9 FPR_UNO.1.1; family behaviour in Sect. 14.5.1",
            trichDan: "...without others, especially third parties, being able to"
                + " observe that the resource or service is being used",
            trangThaiTrich: VERBATIM,
            ketLuan: KHONG_DAT_CO_CHU_Y,
            bangChung: [
                /*
                 * 06/09: ba o cu (`consequence`, `whyNotFixed`,
                 * `recordedInThisRun`) la loi van — da chuyen sang
                 * `BAO_CAO_DINH_TINH.md`. O day chi con SO DO DUOC:
                 * su kien phat ra nhung truong nao, va co bao nhieu
                 * lan rut nguoi ngoai dem duoc.
                 */
                ["withdrawEventFields", truongWithdraw,
                    "su kien Withdraw phat cong khai nhung truong nay"],
                ["withdrawEventsObserved", wd.soLanRut,
                    "so lan rut nguoi ngoai DEM DUOC - dung bang so lan that su xay ra"],
                ["distinctRecipients", wd.soNguoiNhan,
                    "so dia chi nhan hien ro. Dia chi la cong khai theo thiet ke"]
            ]
        }
    ];
}

/*
 * ===================================================================
 * LOC 2026-09-06 — CSV CHI CHUA THU DA DO
 * ===================================================================
 *
 * VI SAO. File nay duoc doc nhu BANG KET QUA — bao cao cho giang vien,
 * phu luc cho bai. Mot dong `out_of_scope` nam xen giua cac dong co so
 * lieu bi doc thanh *"cho nay do that bai"*, trong khi su that la
 * *"cho nay khong do"*. Hai chuyen khac han nhau.
 *
 * ⚠️ KHONG XOA cac dieu kien do khoi `dungBangB` — chung van phai o
 * lai trong code de nguoi doc thay LY DO bo, va de sinh bang trong
 * `.md`. Chi khong ghi ra CSV.
 *
 * 🔴 Noi CHINH THUC cua nhung dieu kien bi bo:
 * `code/BAO_CAO_DINH_TINH.md` muc *"CHOT CUOI — bo dieu kien rieng tu
 * da RUT GON"*. Sua o day thi phai sua ben do trong cung mot luot,
 * neu khong bo bang chung mat dau vet cua nhung thu da bo.
 */
function chuaDo(gia: unknown): boolean {
    return /^(NGOAI PHAM VI|CHUA DO)\b/.test(String(gia ?? "").trim());
}

function dungCsv(branch: string, artifact: any, dongs: Dong[]): string {
    const meta = artifact?.metadata || {};
    const rows: string[][] = [];

    for (const d of dongs) {
        // Ca dieu kien da bo khoi pham vi.
        if (d.ketLuan === NGOAI_PHAM_VI) {
            continue;
        }

        for (const [ten, gia, nghia] of d.bangChung) {
            // Tung o chua do, vi du kenh cau ket cua `R4`.
            if (chuaDo(gia)) {
                continue;
            }

            /*
             * O rong. Vi du `orderSample` o luot `n = 1`: khong co lan
             * rut nao de lay mau. Mot dong co ten ma khong co gia tri
             * chi lam nguoi doc tuong bi mat du lieu.
             */
            if (!Array.isArray(gia) && String(gia ?? "").trim() === "") {
                continue;
            }

            rows.push([
                branch,
                String(meta.finishedAt ?? meta.startedAt ?? ""),
                String(meta.gitCommit ?? ""),
                String(meta.chainId ?? ""),
                d.dieuKien,
                d.ten,
                d.chuan,
                d.chuanRef,
                d.muc,
                d.trichDan,
                d.trangThaiTrich,
                d.ketLuan,
                ten,
                Array.isArray(gia)
                    ? (gia.length === 0 ? "(empty)" : gia.join(" | "))
                    : String(gia ?? ""),
                nghia
            ]);
        }
    }

    return csvTable(HEADER, rows);
}

function buildStandardPropertyCsvs(
    branch: string,
    artifact: any,
    anDanh: any = null
) {
    return {
        transparency: dungCsv(branch, artifact, dungBangA(artifact)),
        privacy: dungCsv(branch, artifact, dungBangB(artifact, anDanh))
    };
}

/*
 * Ghi hai CSV canh file JSON, cung tien to ten.
 * Tra ve duong dan de goi ben ngoai in ra.
 */
function writeStandardPropertyCsvs(branch: string, jsonPath: string) {
    const artifact = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    // Ket qua runner AN DANH, neu da chay. `null` => R2/R3/R5 giu
    // `not_measured_here`, dung nhu thuc te.
    const anDanh = docKetQuaAnDanh(jsonPath, artifact);

    const csvs = buildStandardPropertyCsvs(branch, artifact, anDanh);
    const base = jsonPath.replace(/\.json$/, "");

    // CSV_BOM: khong co no thi Excel doc `✓` / `✗` ra rac.
    const BOM = "﻿";

    const paths = {
        transparency: base + "-A-minhbach.csv",
        privacy: base + "-B-riengtu.csv"
    };

    fs.writeFileSync(paths.transparency, BOM + csvs.transparency, "utf8");
    fs.writeFileSync(paths.privacy, BOM + csvs.privacy, "utf8");

    return paths;
}

if (require.main === module) {
    const jsonPath = process.argv[2];
    const branch = process.argv[3] || "off-chain (ADV)";

    if (!jsonPath) {
        console.error(
            "Dung: npx ts-node src/experiments/tinhChatChuanCsv.ts"
            + " <duong-dan-qualitative-*.json> [nhan-nhanh]"
        );
        process.exitCode = 1;
    } else {
        const paths = writeStandardPropertyCsvs(
            branch,
            path.resolve(jsonPath)
        );

        console.log(JSON.stringify(paths, null, 2));
    }
}

module.exports = {
    buildStandardPropertyCsvs,
    writeStandardPropertyCsvs
};
