// C-13 — Phep do TINH AN DANH (phuc vu C1).
//
// KHAC hoan toan `qualitativeExperiment.ts`:
//   - day la phep do DINH LUONG (ty le anh xa dung / tong), theo n
//   - chay runner RIENG, ghi file RIENG
//   - KHONG doi mot dong nao cua runner dinh tinh
//
// Thiet ke lay tu `paper/working/00_code_followups.md` muc C-13, R4:
//   "chay pool n = {5,10,20}, cho k sinh vien rut, roi tu CHI du lieu
//    on-chain (events + contract state + calldata) thu anh xa moi giao
//    dich rut ve mot commitment. Ghi lai so anh xa dung / tong."
//
// MO HINH DE DOA (phai neu trong bai - R2):
//   Quan sat vien BIET  : danh sach n sinh vien va so tien tung nguoi
//                         duoc duyet (thong tin cap phong ban, coi nhu
//                         cong khai).
//   Quan sat vien KHONG : ai rut lan nao.
//   Duoc dung           : CHI event Withdraw + contract state.
//   KHONG duoc dung     : MongoDB, IPFS, note, proof witness.
//
// Nha truong KHONG nam trong mo hinh nay - ho la ben gui giao dich nen
// von da biet moi thu. C1 chi co nghia voi BEN THU BA quan sat chain.

const fs = require("fs");
const path = require("path");
const {
    execFileSync
} = require("child_process");
// ⚠️ BAT BUOC — dat TRUOC moi require khac.
// Tu Node 19, agent HTTP toan cuc bat keepAlive va TAI SU DUNG socket cu.
// Runner nay goi prover bang spawnSync (chan hoan toan vong lap su kien
// ~15 giay khi n lon). Trong luc bi chan, Ganache dong ket noi dang nam
// khong (~10-15 giay) ma Node khong xu ly duoc tin hieu do. Ghi tiep vao
// socket da chet -> ECONNRESET.
// Tat keepAlive => moi loi goi RPC mo ket noi moi => bi chan bao lau
// cung khong sao. Da kiem chung: chan 15/20/25 giay deu qua.
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

require("dotenv").config({ quiet: true });

const {
    createUniversity
} = require("../services/createUniversityService");
const {
    seedDefaultStaff
} = require("../services/createUniversityStaffService");
const {
    createStudentProfile
} = require("../services/createStudentProfileService");
const {
    approveEligibility
} = require("../services/approveEligibilityService");
const {
    approveFinance
} = require("../services/approveFinanceService");
const {
    createScholarshipPool
} = require("../services/createScholarshipPoolService");
const {
    deployScholarshipPool
} = require("../services/deployScholarshipPoolService");
const {
    registerStudentWallet
} = require("../services/registerStudentWalletService");
const {
    issueScholarship
} = require("../services/issueScholarshipService");
const {
    approveRoot
} = require("../services/approveRootService");
const {
    createWithdrawalRequest
} = require("../services/createWithdrawalRequestService");
const {
    reviewWithdrawalRequest
} = require("../services/reviewWithdrawalRequestService");
const {
    derivePublicKeyFromPrivateKey
} = require("../clients/ipfs/ipfsClient");
const {
    getStudentFromIpfs
} = require("../clients/ipfs/encryptedNoteStorage");
const {
    getPool,
    getWeb3
} = require("../clients/blockchain/blockchainClient");
const {
    connectDatabase,
    disconnectDatabase
} = require("../config/database");
const {
    resetDatabase
} = require("../scripts/resetDatabase");

const EXPERIMENT_DATABASE_PATTERN = /anonymity|qualitative|experiment/i;

type KichBan = {
    n: number;
    withdrawerCount: number;
    sameAmount: boolean;

    /*
     * V2 (30/08) — XAO TRON THU TU GIAI NGAN.
     *
     * Mac dinh `true` vi day la THIET KE cua he, khong phai mot bien de
     * so sanh: mot tai khoan nha truong gui moi lenh rut => mot chuoi
     * nonce => thu tu tren chuoi CHINH LA thu tu backend xu ly. Khong
     * xao thi thu tu do lo ra, va lo BAT KE moi suat co cung menh gia.
     *
     * Dat `false` chi de doi chung bien xau nhat khi can.
     */
    shuffleWithdrawOrder?: boolean;

    // Seed ghi vao artifact de chay lai ra DUNG cung ket qua.
    shuffleSeed?: number;
};

type AnonymityConfig = {
    university: {
        name: string;
        walletAddress: string;
    };
    student: {
        startingStudentId: number;
        amountWei: string;
        amountStep: string;
    };
    scenario: KichBan[];
};

function jsonSafe(value: any) {
    return JSON.parse(JSON.stringify(
        value,
        (_k, v) => typeof v === "bigint" ? v.toString() : v
    ));
}

function currentGitCommit(): string | null {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: path.resolve(__dirname, "../../.."),
            encoding: "utf8"
        }).trim();
    } catch {
        return null;
    }
}

function measurementConditions() {
    const os = require("os");
    const cpus = os.cpus() || [];

    return {
        cpu: cpus[0]?.model || "khong xac dinh",
        cpuCores: cpus.length,
        ramGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        os: os.type() + " " + os.release(),
        nodeVersion: process.version,
        k: 13,
        curve: "BN254 (Fr)",
        provingSystem: "KZG-SHPLONK (snark-verifier-sdk)",
        merkleDepth: 9,
        maxLeaves: 512
    };
}

// Khoa 32 byte sinh xac dinh tu chi so - lap lai duoc.
function keyFromIndex(prefix: string, i: number): string {
    return "0x" + (
        BigInt(prefix) + BigInt(i + 1)
    ).toString(16).padStart(64, "0");
}

function buildStudentList(
    config: AnonymityConfig,
    scenario: KichBan
) {
    const web3 = getWeb3();
    const list = [];

    for (let i = 0; i < scenario.n; i += 1) {
        const noteKey = keyFromIndex(
            "0x1c0de00000000000000000000000000000000000000000000000000000000000",
            i
        );
        const walletKey = keyFromIndex(
            "0x2a11e70000000000000000000000000000000000000000000000000000000000",
            i
        );
        // Moi sinh vien MOT vi rieng - dung nhu he thong that.
        const vi = web3.eth.accounts
            .privateKeyToAccount(walletKey)
            .address;
        // sameAmount = true  -> moi nguoi cung so tien  (tap an danh lon)
        // sameAmount = false -> moi nguoi mot so tien   (amount thanh van tay)
        const amountWei = scenario.sameAmount
            ? config.student.amountWei
            : (
                BigInt(config.student.amountWei)
                + BigInt(config.student.amountStep) * BigInt(i)
            ).toString();

        list.push({
            id: config.student.startingStudentId + i,
            email: "student" + (config.student.startingStudentId + i)
                + "@anonymity.test",
            walletAddress: vi,
            privateKey: noteKey,
            publicKey: derivePublicKeyFromPrivateKey(noteKey),
            amountWei,
            cid: null as string | null,
            commitment: null as string | null,
            merkleIndex: null as number | null,
            hasWithdrawn: false
        });
    }

    return list;
}

// Doc lai ket qua tu file CSV da co, de khong phai chay lai kich ban do.
// Doc theo TEN COT message khong theo vi tri, nen file cu (con 2 cot vi) van doc duoc.
function loadScenarioFromCsv(duong: string, scenario: KichBan) {
    const dong = fs.readFileSync(duong, "utf8")
        .split(/\r?\n/)
        .filter((x: string) => x.length > 0);
    const cot = dong[0].split(",");
    const iTap = cot.indexOf("anonymity_set_by_amount");
    const iDung = cot.indexOf("correct_guess_by_amount");
    const details = dong.slice(1).map((d: string) => {
        const o = d.split(",");

        return {
            anonymitySetByAmount: Number(o[iTap]),
            correctGuessByAmount: o[iDung] === "true"
        };
    });
    const soDung = details.filter(
        (x: any) => x.correctGuessByAmount
    ).length;

    return {
        scenario: scenario,
        loadedFromFile: true,
        withdrawalCount: details.length,
        correctGuessesByAmount: soDung,
        totalWithdrawals: details.length,
        accuracyByAmount: details.length
            ? soDung / details.length
            : 0,
        meanAnonymitySetByAmount: details.length
            ? details.reduce(
                (t: number, x: any) => t + x.anonymitySetByAmount,
                0
            ) / details.length
            : 0,
        details
    };
}

async function resetGuarded() {
    const connection = await connectDatabase();
    const name = String(connection.name || "");

    if (!EXPERIMENT_DATABASE_PATTERN.test(name)) {
        await disconnectDatabase();

        throw new Error(
            "TU CHOI RESET: database \"" + name + "\" khong phai database"
            + " thi nghiem. Doi MONGODB_URI sang database rieng."
        );
    }

    const results = await resetDatabase();

    await disconnectDatabase();

    return results;
}

/*
 * Xao tron TAT DINH theo seed (Fisher-Yates + PRNG mulberry32).
 *
 * VI SAO KHONG DUNG `Math.random()`: chay lai phai ra DUNG cung thu tu,
 * neu khong thi con so trong bao cao khong ai kiem lai duoc. Seed duoc
 * ghi vao artifact.
 */
function prngTuSeed(seed: number) {
    let t = seed >>> 0;

    return function () {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);

        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function xaoTron<T>(mang: T[], seed: number): T[] {
    const ketQua = mang.slice();
    const rand = prngTuSeed(seed);

    for (let i = ketQua.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const tam = ketQua[i] as T;
        ketQua[i] = ketQua[j] as T;
        ketQua[j] = tam;
    }

    return ketQua;
}

// ===================================================================
// QUAN SAT VIEN - chi duoc nhin event Withdraw + contract state
// ===================================================================
function observer(list: any[], events: any[]) {
    const hasDuplicateWallets = new Set(
        list.map((student) => student.walletAddress.toLowerCase())
    ).size !== list.length;

    /*
     * === DUONG 3: NGUOI DUNG CAU KET (them 2026-08-29) ===
     *
     * VI SAO PHAI CO. ISO/IEC 15408-2 (CC:2022) `FPR_UNL.1`, Annex
     * I.4.2.2 doi tinh khong-lien-ket phai dung truoc CA nguoi dung
     * HOP TAC voi nhau ("cooperating users"). Hai duong 1 va 2 chi mo
     * hinh MOT quan sat vien ngoai cuoc => chua phu yeu cau do.
     *
     * MO HINH. Nguoi rut cung la "user" theo nghia cua chuan. Moi
     * nguoi rut biet RIENG mot su that ma quan sat vien ngoai khong
     * biet: nullifier cua chinh minh. Neu ho gop lai thi voi mot lan
     * rut KHONG phai cua ai trong nhom, ca nhom TRU DUOC CHINH MINH ra
     * khoi tap ung vien.
     *
     * TRUONG HOP XAU NHAT, khong phai trung binh: gia thiet TAT CA
     * nhung nguoi rut khac deu cau ket. Chon vay vi no tat dinh
     * (chay lai ra cung so, khong phu thuoc chon ngau nhien nguoi cau
     * ket) va vi no tra loi dung cau chuan hoi: "co dung duoc truoc
     * nguoi dung hop tac khong".
     *
     * GIOI HAN CUA DUONG NAY. Nguoi cau ket chi tru duoc CHINH HO.
     * Sinh vien trung so tien nhung KHONG rut trong luot nay van o
     * lai trong tap ung vien - nhom cau ket khong biet gi ve ho. Nen
     * tap an danh co nhieu nhat `withdrawerCount - 1` phan tu, khong
     * bao gio ve 0.
     */
    /*
     * === DUONG 4: THU TU GIAO DICH (V2, them 30/08) ===
     *
     * CHUAN DOI GI. CC:2022 muc 14.4.5, NOTE duoi element FPR_UNL.1.1:
     * "This SFR intends to look at a chain of interlinked operations by
     *  multiple entities. This chain can be subsumed as a transaction."
     * T5A ghi ve (2) chua dat: "phep do chi phu MOT kenh - chua do
     * tuong quan thoi gian, thu tu giao dich".
     *
     * VI SAO CO KENH NAY. `onlySchool` buoc moi lenh rut di qua MOT tai
     * khoan => MOT chuoi nonce => EVM xu ly dung thu tu => thu tu tren
     * chuoi CHINH LA thu tu backend giai ngan. Ke tan cong biet thu tu
     * nop don thi ghep thang vi tri voi vi tri, KHONG can dung `amount`.
     *
     * CACH DO. `list` giu dung thu tu nop don. Ke tan cong dung phep
     * doan theo vi tri: "lan rut thu i la nguoi nop thu i". Do xem doan
     * dung bao nhieu lan.
     *   - KHONG xao tron -> dung 100%  (kenh mo toang)
     *   - CO xao tron    -> dung ~1/k  (bang doan bua => kenh dong)
     */
    const submissionOrder = list.filter(
        (student: any) => student.hasWithdrawn
    );

    const withdrawerIds = events
        .map((ev: any) => {
            const recipient = String(ev.returnValues.recipient)
                .toLowerCase();
            const sv = list.find(
                (student) =>
                    student.walletAddress.toLowerCase() === recipient
            );

            return sv ? sv.id : null;
        })
        .filter((id: any) => id !== null);

    return events.map((ev: any, viTri: number) => {
        const amount = String(ev.returnValues.amount);
        const recipient = String(ev.returnValues.recipient)
            .toLowerCase();

        // Duong 1: doan qua SO TIEN.
        // Tap ung vien = nhung sinh vien co so tien duyet TRUNG voi
        // so tien thay tren event.
        const candidates = list.filter(
            (student) => String(student.amountWei) === amount
        );

        // Su that (chi runner biet, quan sat vien KHONG) - de cham diem.
        const actual = list.find(
            (student) => student.walletAddress.toLowerCase() === recipient
        );

        // Duong 2: doan qua DIA CHI VI. Moi sinh vien mot vi rieng nen
        // neu quan sat vien biet so dang ky vi thi xac dinh duoc ngay.
        const candidatesByWallet = list.filter(
            (student) => student.walletAddress.toLowerCase() === recipient
        );

        // Duong 3: nhom cau ket = MOI nguoi rut khac trong luot nay.
        // Ho tu loai minh khoi tap ung vien vi moi nguoi biet
        // nullifier cua chinh minh.
        const colluderIds = withdrawerIds.filter(
            (id: any) => !actual || id !== actual.id
        );
        const candidatesAfterCollusion = candidates.filter(
            (student: any) => !colluderIds.includes(student.id)
        );

        // Duong 4: doan theo VI TRI. Phep doan chi ra dung MOT nguoi,
        // nen "tap" luon = 1; thu do duoc la doan DUNG hay SAI.
        const guessByOrder = submissionOrder[viTri];
        const correctByOrder =
            Boolean(actual)
            && Boolean(guessByOrder)
            && (guessByOrder as any).id === actual.id;

        return {
            nullifier: String(ev.returnValues.nullifier),
            observedAmount: amount,
            observedRecipient: recipient,
            // BANG CHUNG: liet ke chinh xac AI la ung vien, va AI la
            // nguoi that su rut. Co hai cot nay moi kiem chung duoc
            // con so `anonymitySetByAmount`.
            candidateIds: candidates.length <= 12
                ? candidates.map((student: any) => student.id).join(" ")
                : candidates.slice(0, 12).map((student: any) => student.id).join(" ")
                    + " ...(" + candidates.length + " nguoi)",
            actualStudentId: actual ? actual.id : "khong xac dinh",
            actualAmountWei: actual ? String(actual.amountWei) : "",
            candidatesIncludeActual:
                Boolean(actual)
                && candidates.some((student: any) => student.id === actual.id),
            anonymitySetByAmount: candidates.length,
            uniquelyIdentifiedByAmount: candidates.length === 1,
            correctGuessByAmount:
                candidates.length === 1
                && Boolean(actual)
                && candidates[0].id === actual.id,
            anonymitySetByWallet: candidatesByWallet.length,
            uniquelyIdentifiedByWallet: candidatesByWallet.length === 1,

            // === Duong 3 - nguoi dung cau ket (FPR_UNL.1 Annex I.4.2.2) ===
            colluderCount: colluderIds.length,
            anonymitySetUnderFullCollusion:
                candidatesAfterCollusion.length,
            uniquelyIdentifiedUnderCollusion:
                candidatesAfterCollusion.length === 1,

            /*
             * Bao nhieu nguoi phai cau ket thi lo danh tinh?
             * Tap an danh co `k` nguoi => phai loai `k - 1` nguoi moi
             * con dung mot. Day la con so TRA LOI THANG cau hoi cua
             * chuan, va no doc duoc ma khong can biet ai cau ket.
             *
             * `k = 1` san roi thi tra ve 0: da lo, khong can ai cau ket.
             */
            colludersNeededToDeanonymize:
                Math.max(0, candidates.length - 1),

            // === Duong 4 - thu tu giao dich (FPR_UNL.1 ve 2) ===
            blockNumber: ev.blockNumber ?? null,
            txIndex: ev.transactionIndex ?? null,
            orderPosition: viTri,
            guessByOrderStudentId: guessByOrder
                ? (guessByOrder as any).id
                : "khong xac dinh",
            correctGuessByOrder: correctByOrder,

            actualStudentIdRef: actual ? actual.id : null,
            duplicateWallets: hasDuplicateWallets
        };
    });
}

// In moc tien do de biet chet o logStep nao khi chay n lon.
function logStep(message: string) {
    process.stderr.write("  [" + new Date().toISOString().slice(11, 19)
        + "] " + message + "\n");
}

// Ket noi HTTP toi Ganache co the rung sau vai phut nam khong (luc phat
// hoc bong chi goi prover + IPFS, khong dung toi chain). Lan goi RPC ke
// tiep se nhan ECONNRESET du Ganache van song.
// Thu lai vai lan la qua - lan sau mo ket noi moi.
async function retry<T>(
    name: string,
    task: () => Promise<T>,
    attempts = 4
): Promise<T> {
    let loiCuoi: any = null;

    for (let i = 1; i <= attempts; i += 1) {
        try {
            return await task();
        } catch (error: any) {
            /*
             * Gom CA BA nguon dau hieu, khong chi `code`.
             *
             * VI SAO: `MongooseServerSelectionError` co `code` =
             * undefined va `cause` la mot `TopologyDescription` (khong
             * co `.code`), nen ban cu roi ve `message` va truot regex
             * => nem luon thay vi thu lai. Da gap that 2026-08-26:
             * Atlas bau lai primary (`ReplicaSetNoPrimary`) chi vai
             * giay, nhung ca luot chay chet.
             */
            const ma = [
                error?.name,
                error?.code,
                error?.cause?.code,
                error?.message
            ].filter(Boolean).join(" | ");

            const laLoiKetNoi =
                /ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT|EPIPE/i.test(ma)
                || /ServerSelection|MongoNetwork|TopologyClosed/i.test(ma)
                || /Could not connect to any servers/i.test(ma)
                || /ReplicaSetNoPrimary|not connected|pool.*cleared/i.test(ma);

            loiCuoi = error;

            if (!laLoiKetNoi || i === attempts) {
                throw error;
            }

            /*
             * Cho TANG DAN: 3s, 6s, 12s, 24s.
             *
             * Atlas bau lai primary co the mat 10-30 giay. Cho co dinh
             * 3 giay la thu lai qua som, 4 lan deu truot roi bo cuoc.
             */
            const cho = 3000 * Math.pow(2, i - 1);

            logStep(
                "loi ket noi o \"" + name + "\" (lan " + i + "/" + attempts
                + "), cho " + (cho / 1000) + " giay roi thu lai"
            );
            await new Promise((r) => setTimeout(r, cho));
        }
    }

    throw loiCuoi;
}

async function runScenario(
    config: AnonymityConfig,
    scenario: KichBan
) {
    logStep("reset database");
    await resetGuarded();

    /*
     * resetGuarded() ket thuc bang disconnectDatabase(), va sau refactor
     * service khong con tu mo ket noi nua -> tang tren phai mo lai.
     */
    await connectDatabase();

    const startedAt = Date.now();
    // Lay vi University tu chinh RPC thay vi doc dia chi cung trong
    // config: Ganache restart la bo account doi, hard-code se hong hoai.
    const taiKhoan: string[] = await getWeb3().eth.getAccounts();
    const schoolWallet = config.university.walletAddress
        && taiKhoan.some(
            (a) => a.toLowerCase()
                === String(config.university.walletAddress).toLowerCase()
        )
            ? String(config.university.walletAddress)
            : String(taiKhoan[0]);

    if (
        config.university.walletAddress
        && schoolWallet.toLowerCase()
            !== String(config.university.walletAddress).toLowerCase()
    ) {
        process.stderr.write(
            "CANH BAO: vi trong config khong duoc RPC unlock, dung"
            + " account[0] = " + schoolWallet + "\n"
        );
    }

    const university = await createUniversity(
        config.university.name,
        schoolWallet
    );
    const uid = university.id;

    // K6 — dung san hai phong ban truoc khi duyet.
    /*
     * MOI loi goi DB deu boc `retry`.
     *
     * VI SAO: `spawnSync` goi prover chan vong lap su kien ~15 giay moi
     * sinh vien. Voi n = 100 la ~25 phut bi chan lien tuc. MongoDB Atlas
     * chay qua TLS, driver khong tra loi heartbeat kip nen ket noi bi rot:
     *   MongoNetworkError: read ECONNRESET
     *   errorLabelSet: HandshakeError, SystemOverloadedError, RetryableError
     *
     * Ban va `keepAlive = false` KHONG cuu duoc cho nay: no chi tac dong
     * len agent http/https (Ganache RPC), con MongoDB dung socket TLS rieng.
     *
     * Da gap that o nhanh ADV 2026-08-25, chet o n = 100 sau khi xong 10/12.
     */
    const staff: any = await retry(
        "dung phong ban",
        () => seedDefaultStaff(uid)
    );
    const list = buildStudentList(config, scenario);

    for (const student of list) {
        await retry(
            "tao ho so sv" + student.id,
            () => createStudentProfile(
                uid, staff.STUDENT_AFFAIRS, student.id, student.email
            )
        );
        await retry(
            "duyet hoc luc sv" + student.id,
            () => approveEligibility(
                uid, staff.STUDENT_AFFAIRS, student.id, "approve"
            )
        );
        await retry(
            "duyet tai chinh sv" + student.id,
            () => approveFinance(
                uid, staff.FINANCE, student.id, student.amountWei
            )
        );
    }

    // Quy phai du cho k lan rut.
    const totalAmount = list.reduce(
        (t, student) => t + BigInt(student.amountWei),
        BigInt(0)
    );
    logStep("da tao xong " + scenario.n + " ho so sinh vien, bat dau deploy pool");
    const pool: any = await retry(
        "tao pool",
        () => createScholarshipPool(uid, staff.FINANCE)
    );
    const deployment = await deployScholarshipPool(
        pool.id,
        staff.FINANCE,
        (totalAmount + BigInt(config.student.amountWei)).toString()
    );

    // Dang ky vi phai SAU khi pool da deploy.
    for (const student of list) {
        await retry(
            "dang ky vi sv" + student.id,
            () => registerStudentWallet(
                uid,
                staff.STUDENT_AFFAIRS,
                pool.id,   // A22 — chuong trinh nao
                student.email,
                student.walletAddress,
                student.publicKey
            )
        );
    }

    let issuedCount = 0;

    for (const student of list) {
        const hb: any = await retry(
            "phat hoc bong sv" + student.id,
            () => issueScholarship(uid, staff.STUDENT_AFFAIRS, student.id)
        );
        issuedCount += 1;

        if (issuedCount % 10 === 0) {
            logStep("da phat " + issuedCount + "/" + scenario.n);
        }

        student.cid = hb.encryptedNoteCid;
        student.commitment = hb.commitment;
        student.merkleIndex = hb.merkleIndex;
    }

    logStep("da phat xong " + scenario.n + " hoc bong, bat dau duyet root");
    // Duyet root MOT LAN sau khi da phat het - root phu thuoc CA n leaf.
    const rootApproval: any = await retry(
        "duyet root",
        () => approveRoot(pool._id.toString(), staff.STUDENT_AFFAIRS)
    );

    // k sinh vien dau tien rut. Kep lai: n = 1 thi khong the co 3 nguoi.
    const actualWithdrawerCount = Math.min(scenario.withdrawerCount, scenario.n);
    const withdrawers = list.slice(0, actualWithdrawerCount);

    /*
     * V2 (30/08) — XAO TRON THU TU GIAI NGAN, mac dinh BAT.
     *
     * `withdrawers` giu thu tu NOP DON. Neu giai ngan dung thu tu do
     * thi thu tu tren chuoi lo nguyen thu tu nop => ke tan cong ghep
     * vi tri voi vi tri la ra danh tinh, khong can dung `amount`.
     *
     * Xao tron o day mo phong dung mot QUY TRINH VAN HANH: nha truong
     * gom cac yeu cau da duyet roi giai ngan theo thu tu ngau nhien.
     * Day KHONG phai thu doan cua mat ma - no la chinh sach, va phai
     * ghi vao khuyen nghi trien khai.
     */
    const shuffleOn = scenario.shuffleWithdrawOrder !== false;
    const seed = scenario.shuffleSeed ?? 12345;
    const disburseOrder = shuffleOn
        ? xaoTron(withdrawers, seed + scenario.n)
        : withdrawers;

    console.error(
        "  [thu tu giai ngan] "
        + (shuffleOn ? "XAO TRON (seed " + seed + ")" : "GIU NGUYEN thu tu nop")
    );

    for (const student of disburseOrder) {
        const note = await getStudentFromIpfs(student.cid, student.privateKey);
        const request: any = await retry(
            "tao yeu cau rut",
            () => createWithdrawalRequest({
                cid: student.cid,
                note
            })
        );
        await retry(
            "duyet va giai ngan",
            () => reviewWithdrawalRequest(request.id, staff.FINANCE, "approve")
        );
        student.hasWithdrawn = true;
    }

    const contract = getPool(deployment.contractAddress);
    const events = await contract.getPastEvents("Withdraw", {
        fromBlock: 0,
        toBlock: "latest"
    });
    const audit = observer(list, jsonSafe(events));
    const correctCount = audit.filter(
        (x: any) => x.correctGuessByAmount
    ).length;

    return {
        scenario: scenario,
        contractAddress: deployment.contractAddress,
        root: String(rootApproval.root),
        studentCount: scenario.n,
        withdrawalCount: audit.length,
        durationMs: Date.now() - startedAt,
        // === KET QUA CHINH ===
        // Duong tan cong 1: so tien
        correctGuessesByAmount: correctCount,
        totalWithdrawals: audit.length,
        accuracyByAmount: audit.length
            ? correctCount / audit.length
            : 0,
        meanAnonymitySetByAmount: audit.length
            ? audit.reduce(
                (t: number, x: any) => t + x.anonymitySetByAmount,
                0
            ) / audit.length
            : 0,
        // Duong tan cong 2: dia chi vi
        correctGuessesByWallet: audit.filter(
            (x: any) => x.uniquelyIdentifiedByWallet
        ).length,

        // Duong tan cong 4: THU TU giao dich (FPR_UNL.1 ve 2)
        shuffleWithdrawOrder: shuffleOn,
        shuffleSeed: shuffleOn ? seed + scenario.n : null,
        correctGuessesByOrder: audit.filter(
            (x: any) => x.correctGuessByOrder
        ).length,
        accuracyByOrder: audit.length
            ? audit.filter((x: any) => x.correctGuessByOrder).length
                / audit.length
            : 0,

        // Duong tan cong 3: nguoi dung cau ket (FPR_UNL.1 Annex I.4.2.2)
        meanAnonymitySetUnderFullCollusion: audit.length
            ? audit.reduce(
                (t: number, x: any) =>
                    t + x.anonymitySetUnderFullCollusion,
                0
            ) / audit.length
            : 0,
        deanonymizedUnderFullCollusion: audit.filter(
            (x: any) => x.uniquelyIdentifiedUnderCollusion
        ).length,
        // Nguong: it nhat bao nhieu nguoi cau ket la du lo MOT nguoi.
        // Lay MIN vi ke tan cong chi can mot lan rut de danh.
        minColludersNeededToDeanonymize: audit.length
            ? Math.min(
                ...audit.map(
                    (x: any) => x.colludersNeededToDeanonymize
                )
            )
            : 0,
        details: audit
    };
}

async function runAnonymityExperiment(
    config: AnonymityConfig,
    outputDirectory = path.resolve(
        __dirname,
        "../../../experiments/results/anonymity"
    )
) {
    /*
     * Chot chan khoa CU trong config (doi ten 2026-08-24).
     *
     * Khoa cu khong duoc doc => roi vao gia tri mac dinh MA KHONG BAO GI,
     * dung kieu hong da gap voi `run.soSinhVien` cua runner dinh tinh.
     * Tha dung con hon chay ra ket qua sai ma khong ai biet.
     */
    const KHOA_CU: Array<[string, string]> = [
        ["idBatDau", "startingStudentId"],
        ["buocTien", "amountStep"],
        ["kichBan", "scenario"]
    ];

    for (const [cu, moi] of KHOA_CU) {
        const coOStudent = (config as any)?.student?.[cu] !== undefined;
        const coOGoc = (config as any)?.[cu] !== undefined;

        if (coOStudent || coOGoc) {
            throw new Error(
                "Config con dung khoa CU `" + cu + "`. Doi thanh `"
                + moi + "` (doi ten 2026-08-24)."
            );
        }
    }

    if (
        !config?.university?.name
        || !Array.isArray(config?.scenario)
        || config.scenario.length === 0
    ) {
        throw new Error("Anonymity experiment configuration is incomplete");
    }

    fs.mkdirSync(outputDirectory, { recursive: true });

    // Dat bien LAM_LAI=1 de chay lai tat ca, ke ca kich ban da co ket qua.
    const lamLai = process.env.LAM_LAI === "1";

    const startedAt = new Date();
    const results = [];
    const duongDan: string[] = [];

    for (const scenario of config.scenario) {
        const tenFile = "anonymity_n" + scenario.n
            + (scenario.sameAmount ? "_cungtien" : "_khactien")
            + ".csv";
        const duongFile = path.join(outputDirectory, tenFile);

        if (fs.existsSync(duongFile) && !lamLai) {
            process.stderr.write(
                "\nBO QUA (da co ket qua): " + tenFile + "\n"
            );
            results.push(loadScenarioFromCsv(duongFile, scenario));
            duongDan.push(duongFile);
            continue;
        }

        process.stderr.write(
            "\n=== KICH BAN n=" + scenario.n
            + " k=" + scenario.withdrawerCount
            + " sameAmount=" + scenario.sameAmount + " ===\n"
        );

        const r = await runScenario(config, scenario);

        results.push(r);

        const name = "anonymity_n" + scenario.n
            + (scenario.sameAmount ? "_cungtien" : "_khactien")
            + ".csv";
        const header = [
            "n",
            "withdrawer_count",
            "same_amount",
            "nullifier",
            "observed_amount",
            "observed_recipient",
            "candidate_ids",
            "actual_student_id",
            "actual_amount_wei",
            "candidates_include_actual",
            "anonymity_set_by_amount",
            "uniquely_identified_by_amount",
            "correct_guess_by_amount",
            // Duong 3 - them 2026-08-29, DAT O CUOI de khong xe dich
            // chi so cot ma `docCsvCu` doc lai bang `indexOf(ten)`.
            "colluder_count",
            "anonymity_set_under_full_collusion",
            "uniquely_identified_under_collusion",
            "colluders_needed_to_deanonymize",
            // Duong 4 - them 30/08, DAT O CUOI de khong xe dich cot cu.
            "shuffle_withdraw_order",
            "block_number",
            "tx_index",
            "order_position",
            "guess_by_order_student_id",
            "correct_guess_by_order"
        ];
        const rows = r.details.map((x: any) => [
            scenario.n,
            scenario.withdrawerCount,
            scenario.sameAmount,
            x.nullifier,
            x.observedAmount,
            x.observedRecipient,
            x.candidateIds,
            x.actualStudentId,
            x.actualAmountWei,
            x.candidatesIncludeActual,
            x.anonymitySetByAmount,
            x.uniquelyIdentifiedByAmount,
            x.correctGuessByAmount,
            x.colluderCount,
            x.anonymitySetUnderFullCollusion,
            x.uniquelyIdentifiedUnderCollusion,
            x.colludersNeededToDeanonymize,
            r.shuffleWithdrawOrder,
            x.blockNumber,
            x.txIndex,
            x.orderPosition,
            x.guessByOrderStudentId,
            x.correctGuessByOrder
        ]);
        const duong = path.join(outputDirectory, name);

        fs.writeFileSync(
            duong,
            [header, ...rows]
                .map((row) => row.join(","))
                .join("\r\n") + "\r\n",
            "utf8"
        );
        duongDan.push(duong);
    }

    const ketThuc = new Date();
    const tomTat = jsonSafe({
        metadata: {
            measurement: "C-13 - anonymity measurement (serving C1)",
            branch: "on-chain (ONC)",
            startedAt: startedAt.toISOString(),
            finishedAt: ketThuc.toISOString(),
            gitCommit: currentGitCommit(),
            measurementConditions: measurementConditions()
        },
        threatModel: {
            observerKnows:
                "the list of n students and the amount approved for each",
            observerDoesNotKnow: "who performed which withdrawal",
            allowedSources: "ONLY the Withdraw events and the contract state",
            forbiddenSources:
                "MongoDB, IPFS, note contents, private witnesses",
            note:
                "The university is OUTSIDE this model - it is the sender of"
                + " the transactions and therefore already knows everything."
                + " C1 only has meaning against a THIRD PARTY observing the chain.",

            /*
             * Duong 3 them 2026-08-29 de phu `FPR_UNL.1` Annex I.4.2.2
             * ("cooperating users"). Truoc do C-13 chi mo hinh MOT quan
             * sat vien ngoai cuoc, nen tai lieu phai tu khai la thieu.
             */
            collusionModel:
                "Attack path 3 additionally models COLLUDING WITHDRAWERS,"
                + " as required by ISO/IEC 15408-2 (CC:2022) FPR_UNL.1"
                + " Annex I.4.2.2. Each withdrawer privately knows their own"
                + " nullifier, so a coalition can subtract ITSELF from the"
                + " candidate set of any withdrawal it did not make.",
            collusionAssumption:
                "WORST CASE, not average: every other withdrawer in the run"
                + " is assumed to collude. Chosen because it is deterministic"
                + " - no random choice of coalition - so the number is"
                + " reproducible across runs.",
            orderingChannel:
                "Attack path 4 models an observer who knows the SUBMISSION"
                + " order and guesses that the i-th withdrawal on chain"
                + " belongs to the i-th applicant. This channel exists"
                + " because `onlySchool` routes every withdrawal through a"
                + " single account, so one nonce sequence fixes the on-chain"
                + " order to the backend's disbursement order.",
            orderingMitigation:
                "The university SHUFFLES the approved requests before"
                + " disbursing (scenario.shuffleWithdrawOrder, default on)."
                + " This is an OPERATIONAL policy, not a cryptographic"
                + " guarantee - a deployment that disburses in submission"
                + " order leaks identity through ordering even when every"
                + " grant carries the same amount.",
            orderingMeasurementCondition:
                "Ganache auto-mines one transaction per block, so block"
                + " order is fully visible. On a real chain several"
                + " withdrawals share a block and intra-block order is the"
                + " proposer's choice, making this channel weaker. Both"
                + " block_number and tx_index are reported.",
            collusionBound:
                "A coalition can only remove ITSELF. Students whose approved"
                + " amount matches but who did NOT withdraw in this run stay"
                + " in the candidate set, so the anonymity set never reaches"
                + " zero and shrinks by at most (withdrawerCount - 1)."
        },
        results: results.map((r: any) => ({
            n: r.scenario.n,
            withdrawerCount: r.scenario.withdrawerCount,
            sameAmount: r.scenario.sameAmount,
            correctGuessesByAmount: r.correctGuessesByAmount,
            totalWithdrawals: r.totalWithdrawals,
            accuracyByAmount: r.accuracyByAmount,
            meanAnonymitySetByAmount:
                r.meanAnonymitySetByAmount,
            correctGuessesByWallet: r.correctGuessesByWallet,
            shuffleWithdrawOrder: r.shuffleWithdrawOrder,
            correctGuessesByOrder: r.correctGuessesByOrder,
            accuracyByOrder: r.accuracyByOrder,
            meanAnonymitySetUnderFullCollusion:
                r.meanAnonymitySetUnderFullCollusion,
            deanonymizedUnderFullCollusion:
                r.deanonymizedUnderFullCollusion,
            minColludersNeededToDeanonymize:
                r.minColludersNeededToDeanonymize,
            durationMs: r.durationMs
        })),
        details: results
    });
    const duongTomTat = path.join(
        outputDirectory,
        "anonymity_summary.json"
    );

    fs.writeFileSync(
        duongTomTat,
        JSON.stringify(tomTat, null, 2),
        "utf8"
    );

    return {
        summaryPath: duongTomTat,
        csvPaths: duongDan,
        result: tomTat
    };
}

module.exports = {
    runAnonymityExperiment,
    observer,

    /*
     * Xuat them 2026-09-05 de test duoc KENH THU TU cua `R4` ma khong
     * phai chay ca thuc nghiem an danh (~5 gio moi repo).
     *
     * Kenh thu tu: `onlySchool` buoc moi lan rut di qua MOT tai khoan,
     * nen thu tu tren chuoi = thu tu backend giai ngan. Ai biet thu tu
     * nop don thi ghep duoc vi tri voi vi tri. `xaoTron` la co che bit
     * kenh do.
     */
    xaoTron,
    prngTuSeed
};

if (require.main === module) {
    const duongConfig = process.argv[2];

    if (!duongConfig) {
        console.error(
            "Usage: npm run experiment:anonymity -- <configuration.json>"
        );
        process.exitCode = 1;
    } else {
        const config = JSON.parse(
            fs.readFileSync(path.resolve(duongConfig), "utf8")
        );

        runAnonymityExperiment(config)
            .then((out: any) => {
                console.log(
                    "ANONYMITY SUMMARY:",
                    out.summaryPath
                );

                for (const p of out.csvPaths) {
                    console.log("  CSV:", p);
                }
            })
            .catch((error: any) => {
                console.error("ANONYMITY EXPERIMENT FAILED");
                console.error(error);
                process.exitCode = 1;
            })
            .finally(disconnectDatabase);
    }
}
