// ⚠️ BAT BUOC — dat TRUOC moi require khac.
// Tu Node 19, agent HTTP toan cuc bat keepAlive va TAI SU DUNG socket cu.
// Runner nay goi prover bang spawnSync, chan hoan toan vong lap su kien
// (~15 giay moi sinh vien). Trong luc bi chan, Ganache dong ket noi dang
// nam khong ma Node khong xu ly duoc tin hieu do. Ghi tiep vao socket da
// chet -> ECONNRESET.
//
// Voi n = 1 hoac n = 2 khong thay vi luot chay qua ngan. Tu n lon (K7)
// thi chet giua chung. Da gap that 2026-08-20 o luot n lon.
// Tat keepAlive => moi loi goi RPC mo ket noi moi => bi chan bao lau
// cung khong sao. Da kiem chung o `anonymityExperiment.ts`: 15/20/25 giay.
require("http").globalAgent.keepAlive = false;
require("https").globalAgent.keepAlive = false;

const fs = require("fs");
const path = require("path");
const {
    execFileSync
} = require("child_process");
const {
    seedDefaultStaffController
} = require("../controllers/staffController");

const {
    createUniversityController
} = require("../controllers/universityController");
const {
    createStudentProfileController,
    approveEligibilityController,
    approveFinanceController,
    registerStudentWalletController
} = require("../controllers/studentController");
const {
    createPoolController,
    deployPoolController,
    fundPoolController
} = require("../controllers/poolController");
const {
    issueScholarshipController,
    approveRootController
} = require("../controllers/scholarshipController");
const {
    createWithdrawalRequestController,
    reviewWithdrawalRequestController
} = require("../controllers/withdrawalController");
const {
    derivePublicKeyFromPrivateKey
} = require("../clients/ipfs/noteEncryption");
const {
    readEncryptedNote,
    getStudentFromIpfs
} = require("../clients/ipfs/encryptedNoteStorage");
const {
    getWeb3,
    getShieldedPoolContract
} = require("../clients/blockchain/shieldedPoolClient");
const {
    privateWitnessLeakageCheck
} = require("./publicSurfaceAudit");
const {
    connectDatabase,
    disconnectDatabase
} = require("../config/database");
const {
    resetDatabase
} = require("../scripts/resetDatabase");
const {
    writeStandardPropertyCsvs
} = require("./tinhChatChuanCsv");

const {
    runRust
} = require("../clients/prover/halo2ProverClient");

// Bi danh de than ham `dungLaiGocTuSuKien` GIONG HET giua hai repo —
// chi khac dung mot dong nay, vi hai nhanh dat ten adapter khac nhau.
const goiProver = runRust;

// University.name va University.walletAddress deu `unique` toan cuc,
// nen chay lai runner tren database da co du lieu se LUON that bai.
// Vi vay runner ho tro tu reset - nhung CHI khi duoc bat ro trong config,
// va CHI tren database co ten dung khuon thi nghiem.
const EXPERIMENT_DATABASE_PATTERN = /qualitative|experiment/i;

async function resetExperimentDatabaseGuarded() {
    const connection = await connectDatabase();
    const databaseName = String(connection.name || "");

    if (!EXPERIMENT_DATABASE_PATTERN.test(databaseName)) {
        await disconnectDatabase();

        throw new Error(
            "TU CHOI RESET: database \"" + databaseName + "\" khong"
            + " phai database thi nghiem. Runner chi reset database co"
            + " name chua \"qualitative\" hoac \"experiment\". Doi"
            + " MONGODB_URI sang mot database rieng, dung reset database"
            + " dang chua du lieu chay tay."
        );
    }

    const result = await resetDatabase();

    await disconnectDatabase();

    return result;
}

type QualitativeExperimentConfig = {
    university: {
        name: string;
        walletAddress: string;
        privateKey?: string;
    };
    student: {
        id: number;
        email: string;
        walletAddress: string;
        privateKey: string;
        wrongPrivateKey?: string;
    };
    scholarship: {
        amountWei: string;
    };
    pool: {
        initialFundingWei: string;
        sponsorWalletAddress?: string;
        sponsorAmountWei?: string;
    };
    run?: {
        resetDatabase?: boolean;

        /*
         * A23 — dung CHUNG dataset voi dinh luong.
         *
         * `true`  -> doc `experiments/data/dataset_n<studentCount>.json`
         *            va lay `student_id` · `amount` · `note.rho` tu do.
         *            Hai thi nghiem chay tren DUNG MOT tap sinh vien
         *            => bai duoc noi "cung dau vao" cho CA HAI.
         * `false` -> tu sinh nhu truoc (giu de lap lai luot chay cu).
         */
        useSharedDataset?: boolean;

        /*
         * K7 — so sinh vien trong pool cho luot chay nay.
         *
         * Bo trong hoac 1  => chay Y HET nhu truoc, artifact khong doi
         *                     mot truong nao. Day la mac dinh CO CHU Y:
         *                     `draft/4_experiments.md` dang trich thang
         *                     ten truong cua ban n = 1.
         * > 1              => sinh vien so 0 van la `config.student`,
         *                     nhung co them (n-1) sinh vien sinh xac dinh.
         *
         * Chi TIEU CHI 4 manh len theo n (soi be mat cong khai cua nhieu
         * note trong cung mot cay). Ba tieu chi con lai la tinh chat cua
         * contract va cua dinh dang phong bi, khong phu thuoc n — dung
         * trinh bay chung nhu the n lam chung manh len.
         */
        studentCount?: number;

        /*
         * V2 — seed cho xao tron thu tu giai ngan. Co dinh de luot
         * chay TAI LAP DUOC: nguoi khac chay lai cung seed phai ra
         * cung hoan vi, neu khong thi khong ai kiem lai duoc.
         */
        shuffleSeed?: number;
    };
};

/*
 * K7 — sinh (n-1) sinh vien phu cho luot chay nhieu sinh vien.
 *
 * VI SAO LAY VI TU GANACHE (doi 2026-08-20):
 * ban truoc suy khoa bang SHA-256(pk_sv0 || index) nen vi sinh vien
 * KHONG nam trong Ganache. Chay duoc, nhung LECH CHUAN voi thuc nghiem
 * DINH LUONG — ben do dung `HDNodeWallet.fromPhrase(GANACHE_MNEMONIC,
 * m/44'/60'/0'/0/i)` roi doi chieu voi `eth.getAccounts()`
 * (`prepareExperimentInputs.ts`, truong `ganache_account_index` trong
 * `dataset_n*.json`). Hai thuc nghiem cua cung mot he thong ma tao vi
 * theo hai cach la thu kho bao ve truoc phan bien.
 *
 * Nay dung Y HET dinh luong:
 *   - cung mnemonic  "test test ... junk"
 *   - cung duong dan  m/44'/60'/0'/0/{index}
 *   - school = index 0, sinh vien i = index (offset + i), offset = 1
 *   - DOI CHIEU voi eth.getAccounts(): lech la DUNG, khong chay tiep
 *
 * VI SAO VAN PHAI SUY KHOA CHU KHONG HOI GANACHE:
 * RPC khong tra private key. Ma sinh vien CAN khoa rieng de giai ma note
 * (ECDH). Nen: suy tu mnemonic de co khoa, roi hoi Ganache dia chi de
 * doi chieu. Trung nhau tuc la dung vi cua Ganache that.
 *
 * ⚠️ Ganache phai chay dung mnemonic va du so tai khoan:
 *   ganache --wallet.mnemonic "test test test test test test test test test test test junk" \
 *           --wallet.totalAccounts 120
 */
const GANACHE_MNEMONIC =
    process.env.GANACHE_MNEMONIC
    || "test test test test test test test test test test test junk";

// Giong `prepareExperimentInputs.ts` cua nhanh dinh luong.
const SCHOOL_ACCOUNT_INDEX = 0;
const STUDENT_ACCOUNT_OFFSET = 1;

/*
 * Sponsor nam NGOAI dai sinh vien.
 *
 * Sinh vien chiem index 1..n, n toi da 100. Neu sponsor dung mot index
 * trong dai do thi no vua la nha tai tro vua la nguoi nhan hoc bong —
 * so du bi tron, khong con doc duoc.
 *
 * Chon 119 vi lenh khoi dong da chuan hoa la
 * `--wallet.totalAccounts 120` (index 0..119), nen 119 la o cuoi cung
 * va khong bao gio dung do voi sinh vien.
 */
const SPONSOR_ACCOUNT_INDEX = 119;

function walletFromMnemonic(index: number) {
    const { HDNodeWallet } = require("ethers");
    const wallet = HDNodeWallet.fromPhrase(
        GANACHE_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${index}`
    );

    return {
        index,
        address: wallet.address,
        privateKey: wallet.privateKey
    };
}

/*
 * Chot an toan: dia chi suy tu mnemonic PHAI trung dia chi Ganache bao.
 * Lech => Ganache dang chay mnemonic khac, hoac khong du tai khoan.
 * Tha dung con hon chay tiep voi vi khong thuoc Ganache — vi nhu vay la
 * am tham quay lai dung cai da bo.
 */
async function assertGanacheAccounts(
    requiredAccountCount: number
) {
    const web3 = getWeb3();
    const list: string[] = await web3.eth.getAccounts();

    if (list.length < requiredAccountCount) {
        throw new Error(
            "Ganache chi co " + list.length + " tai khoan, can "
            + requiredAccountCount + ". Khoi dong lai bang:\n"
            + "  ganache --wallet.mnemonic \"" + GANACHE_MNEMONIC
            + "\" --wallet.totalAccounts 120"
        );
    }

    for (let i = 0; i < requiredAccountCount; i += 1) {
        const derived = walletFromMnemonic(i).address.toLowerCase();
        const fromGanache = String(list[i]).toLowerCase();

        if (derived !== fromGanache) {
            throw new Error(
                "Tai khoan Ganache KHONG khop mnemonic tai index " + i
                + ".\n  Ganache : " + list[i]
                + "\n  Suy ra  : " + walletFromMnemonic(i).address
                + "\nGanache dang chay mnemonic khac. Khoi dong lai bang:\n"
                + "  ganache --wallet.mnemonic \"" + GANACHE_MNEMONIC
                + "\" --wallet.totalAccounts 120"
            );
        }
    }

    return list;
}

function deriveExtraStudents(
    count: number,
    baseStudent: {
        id: number;
        email: string;
        privateKey: string;
    }
) {
    const list: {
        // A23 — vi tri trong dataset: sinh vien thu i <-> dong i.
        index: number;
        id: number;
        email: string;
        walletAddress: string;
        privateKey: string;
        ganacheAccountIndex: number;
    }[] = [];

    for (let i = 1; i <= count; i += 1) {
        // sinh vien 0 dung index STUDENT_ACCOUNT_OFFSET,
        // sinh vien i dung index STUDENT_ACCOUNT_OFFSET + i.
        const accountIndex = STUDENT_ACCOUNT_OFFSET + i;
        const vi = walletFromMnemonic(accountIndex);
        const id = baseStudent.id + i;

        list.push({
            index: i,
            id,
            email: id + "@gmail.com",
            walletAddress: vi.address,
            privateKey: vi.privateKey,
            ganacheAccountIndex: accountIndex
        });
    }

    return list;
}

function cleanHexLocal(value: string): string {
    return String(value || "")
        .trim()
        .replace(/^0x/i, "")
        .toLowerCase();
}

// Thang danh gia cua outline muc 2.1.3.
const DAT = "pass";
const DAT_MOT_PHAN = "partial";
const KHONG_DAT = "fail";


/*
 * Do sau cay Merkle he DANG chay. PHAI khop hang so Rust:
 *   ADV prover/src/inputs_builder.rs   MERKLE_DEPTH
 *   ONC prover/src/flow_inputs.rs      MERKLE_DEPTH
 * Dung mot cho duy nhat cho ca `measurementConditions` lan phep kiem
 * dataset ben duoi, de hai cho khong the lech nhau.
 */
const MERKLE_DEPTH_HIEN_TAI = 9;
const MAX_LEAVES_HIEN_TAI = 2 ** MERKLE_DEPTH_HIEN_TAI;

/*
 * ===================================================================
 * A23 — DUNG CHUNG DATASET VOI DINH LUONG
 * ===================================================================
 *
 * VI SAO. Truoc day runner dinh tinh TU SINH sinh vien: `student_id`
 * tu config, `amount` tu config, `rho` sinh ngau nhien trong
 * `createStudentNote`. Runner dinh luong thi doc
 * `experiments/data/dataset_n*.json`. Hai ben chay tren HAI tap du
 * lieu khac nhau => bai KHONG duoc noi "cung dau vao".
 *
 * NAY. Bat `run.useSharedDataset` thi runner doc dung file dataset ma
 * dinh luong dung, va lay ba thu: `student_id` · `amount` · `note.rho`.
 *
 * VI SAO CHI BA THU DO:
 *   - VI da trung san tu truoc: ca hai deu dan xuat tu cung mnemonic
 *     Ganache, `dataset.students[i].ganache_account_index` = i + 1 =
 *     dung cong thuc `STUDENT_ACCOUNT_OFFSET + i` cua runner nay.
 *   - `cid` KHONG the trung: note duoc ma hoa lai voi nonce AES-GCM
 *     moi => ciphertext khac => CID khac. Chi DAU VAO trung, khong
 *     phai dau ra. Phai khai dieu nay trong bao cao.
 *
 * KHONG BAT thi giu nguyen hanh vi cu (tu sinh) — de cac luot chay cu
 * van lap lai duoc.
 */
/*
 * ===================================================================
 * THU LAI KHI ATLAS RUNG KET NOI (them 2026-09-02)
 * ===================================================================
 *
 * VI SAO PHAI CO O DAY. Ngay 02/09 luot ONC `n = 500` CHET sau 500 lan
 * duyet tai chinh voi `MongoServerSelectionError: read ECONNRESET` /
 * `ReplicaSetNoPrimary` — mat ~1 gio chay va KHONG sinh duoc file ket
 * qua nao. Runner AN DANH da co ham nay tu 26/08 va song sot qua dung
 * tinh huong do; runner dinh tinh thi chua, nen chet.
 *
 * Ham duoi day chep NGUYEN VAN tu `anonymityExperiment.ts` de hai runner
 * xu ly su co mang giong het nhau.
 */
/*
 * Bo qua mot buoc DA CHAY XONG o lan thu truoc (them 2026-09-05).
 *
 * VI SAO CAN. `retry` boc ca khoi mot sinh vien. Neu ket noi Atlas rung
 * GIUA CHUNG — vi du da tao ho so va duyet dieu kien xong roi moi rung —
 * thi lan thu lai chay LAI TU DAU khoi do va dam vao
 * "Student profile already exists".
 *
 * Da gap that 2026-09-05: luot ADV n = 500 chet o sinh vien 24560039
 * dung theo kieu nay.
 *
 * 🔴 CHI dung cho nhung buoc TAO MOI trong mot luot chay da reset sach
 * database. O do "da ton tai" chi co the nghia la "chinh luot nay vua
 * tao xong roi mat phan hoi" — khong phai du lieu cu.
 */
/*
 * ===================================================================
 * M4 — DUNG LAI CAY THAT, khong chi do TEN tham so trong ABI
 * ===================================================================
 *
 * 🔴 VI SAO CO HAM NAY (them 2026-09-12).
 *
 * Truoc day `rootReconstructibleByThirdParty` duoc danh `✓` bang cach
 * duy nhat: quet ABI xem co su kien nao co tham so TEN chua
 * "commitment" khong. Ket luan dung, nhung bang chung MONG — no chung
 * minh "co cho de lay du lieu", chu KHONG chung minh "lay ra bam lai
 * thi dung goc".
 *
 * `M4` (NIST IR 8202) doi dung cai sau: *"users can independently agree
 * on the current state"*. Nen ham nay lam dung viec do:
 *
 *   1. Lay mang commitment tu SU KIEN `CommitmentsPublished` tren chuoi
 *      — khong lay tu bien trong bo nho cua runner.
 *   2. Day vao mode `root` cua prover — cung binary, cung hop dong
 *      stdin/stdout ma `clients/prover` dung.
 *   3. So goc tra ve voi `currentRoot` DOC TU HOP DONG.
 *
 * ⚠️ KHONG dung bi mat nao cua sinh vien (`student_id`, `rho`). Day dung
 * la thu mot nguoi ngoai lam duoc, nen no moi la bang chung cho `M4`.
 *
 * 🔵 Tra `null` khi khong du dieu kien (khong co su kien, prover loi).
 * KHONG nem loi: mot luot chay khong duoc chet vi phep kiem phu.
 */
function dungLaiGocTuSuKien(
    events: any[],
    gocTrenChuoi: unknown
): {
    leafCount: number;
    rebuiltRoot: string;
    onChainRoot: string;
    matches: boolean;
} | null {
    const congBo = (events || []).filter(
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
        const ra = goiProver("root", { commitments: camKet });
        const bamLai = String(ra?.root || "").toLowerCase();
        const trenChuoi = String(gocTrenChuoi || "").toLowerCase();

        return {
            leafCount: camKet.length,
            rebuiltRoot: String(ra?.root || ""),
            onChainRoot: String(gocTrenChuoi || ""),
            matches: bamLai.length > 0 && bamLai === trenChuoi
        };
    } catch (error: any) {
        console.error(
            "  dung lai cay THAT BAI: "
            + String(error?.message || error)
        );

        return null;
    }
}

async function boQuaNeuDaLam<T>(task: () => Promise<T>): Promise<T | null> {
    try {
        return await task();
    } catch (error: any) {
        const thongBao = String(error?.message || "");

        if (/already exists|already used|E11000|duplicate key/i.test(thongBao)) {
            return null;
        }

        throw error;
    }
}

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

            console.error(
                "loi ket noi o \"" + name + "\" (lan " + i + "/" + attempts
                + "), cho " + (cho / 1000) + " giay roi thu lai"
            );
            await new Promise((r) => setTimeout(r, cho));
        }
    }

    throw loiCuoi;
}

/*
 * ===================================================================
 * V2 — XAO TRON THU TU GIAI NGAN (end-to-end, them 2026-09-05)
 * ===================================================================
 *
 * KENH BI BIT. `ShieldedPool` dat `onlySchool` tren ham rut, nen MOI lan
 * rut deu di qua MOT tai khoan => mot chuoi nonce => thu tu tren chuoi
 * BANG DUNG thu tu backend giai ngan. Quan sat vien biet thu tu nop don
 * chi can dem: don thu 7 => lan rut thu 7. Khong can so tien, khong can
 * vi — mot duong nham doc lap hoan toan voi hai kenh kia.
 *
 * `ISO/IEC 15408-2` muc 14.4.5, NOTE duoi `FPR_UNL.1.1`:
 *   "This SFR intends to look at a chain of interlinked operations by
 *    multiple entities. This chain can be subsumed as a transaction."
 *
 * KHAC voi test don vi `withdrawOrderChannel.test.ts`: test do chung
 * minh HAM xao tron chay dung. Cho nay do TREN HE THAT — co onlySchool,
 * co nonce that, co 500 giao dich len chuoi that.
 *
 * TAT DINH THEO SEED. Dung `Math.random()` thi khong ai kiem lai duoc
 * luot chay da cong bo. Seed ghi vao file ket qua.
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

function docDatasetDungChung(studentCount: number) {
    const duong = path.resolve(
        __dirname,
        "../../../experiments/data/dataset_n" + studentCount + ".json"
    );

    if (!fs.existsSync(duong)) {
        throw new Error(
            "useSharedDataset = true nhung khong tim thay " + duong
            + ". Cac gia tri n co dataset: xem experiments/data/."
            + " Hoac dat run.useSharedDataset = false de tu sinh."
        );
    }

    const dataset = JSON.parse(fs.readFileSync(duong, "utf8"));

    if (Number(dataset.n) !== Number(studentCount)) {
        throw new Error(
            "Dataset " + duong + " co n = " + dataset.n
            + " nhung run.studentCount = " + studentCount
        );
    }

    const students = dataset.students || [];

    if (students.length !== Number(studentCount)) {
        throw new Error(
            "Dataset " + duong + " khai n = " + dataset.n
            + " nhung chi co " + students.length + " sinh vien"
        );
    }

    /*
     * Chot chan quan trong: dataset ghi `merkle_depth` cua chinh no.
     * Neu no khac do sau ma prover dang dung thi cay dung ra se khac,
     * va so do se sai MA KHONG BAO GI. Kiem o day cho chet som.
     */
    if (
        dataset.merkle_depth !== undefined
        && Number(dataset.merkle_depth) !== Number(MERKLE_DEPTH_HIEN_TAI)
    ) {
        throw new Error(
            "Dataset co merkle_depth = " + dataset.merkle_depth
            + " nhung he dang chay do sau " + MERKLE_DEPTH_HIEN_TAI
            + ". Sinh lai dataset hoac doi do sau cho khop."
        );
    }

    const rows = students.map(
        (sv: any, i: number) => ({
            index: i,
            studentId: Number(sv.student_id),
            amountWei: String(sv.note?.amount ?? sv.amount),
            rho: String(sv.note?.rho),
            walletAddress: String(sv.address),
            ganacheAccountIndex: Number(sv.ganache_account_index)
        })
    );

    /*
     * Chot chan thu hai: VI phai trung.
     *
     * Runner nay KHONG doc `address` cua dataset — no tu dan xuat vi tu
     * mnemonic Ganache theo `STUDENT_ACCOUNT_OFFSET + i`. Hai ben trung
     * nhau la vi CUNG mnemonic, khong phai vi co ai ep. Neu ai do doi
     * mnemonic, doi offset, hoac sinh lai dataset tren mot chain khac
     * thi hai ben lech ma KHONG BAO GI: dinh tinh van chay xong, chi la
     * chay tren mot nguoi khac. Doi chieu o day cho no chet som.
     *
     * Khong dung `private_key` cua dataset — khoa da co san tu mnemonic,
     * va khong nen keo them mot ban sao khoa bi mat vao runner nay.
     */
    for (const row of rows) {
        const suyRa = walletFromMnemonic(
            STUDENT_ACCOUNT_OFFSET + row.index
        ).address;

        if (row.walletAddress.toLowerCase() !== suyRa.toLowerCase()) {
            throw new Error(
                "Dataset lech vi o sinh vien thu " + row.index
                + " (" + duong + ")"
                + "\n  Dataset : " + row.walletAddress
                + "\n  Suy ra  : " + suyRa
                + "\nDataset duoc sinh tren mot mnemonic khac voi"
                + " GANACHE_MNEMONIC dang dung. Hai thuc nghiem se"
                + " KHONG con chung dau vao."
            );
        }
    }

    return rows;
}

// Ham rut tien co nhan proof lam tham so khong?
// ADV: withdrawOffChain(root, nullifier, recipient, amount) -> KHONG.
// ONC: withdraw(..., proof) -> CO.
// Doc tu ABI chu khong hard-code, de ban port sang ONC tu cham dung.
function withdrawBindsProofOnChain(
    contractInterface: any[]
): boolean {
    return (contractInterface || []).some(
        (item: any) =>
            item.type === "function"
            && /^withdraw/i.test(item.name || "")
            && (item.inputs || []).some(
                (input: any) =>
                    /proof|calldata/i.test(input.name || "")
                    || input.type === "bytes"
            )
    );
}

// C-14: dieu kien do phai di kem MOI so lieu, neu khong thi so sanh
// khong bao ve duoc truoc reviewer.
function measurementConditions() {
    const os = require("os");
    const cpus = os.cpus() || [];

    return {
        cpu: cpus[0]?.model || "khong xac dinh",
        cpuCores: cpus.length,
        ramGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        os: os.type() + " " + os.release(),
        nodeVersion: process.version,
        iterations: 1,
        k: 9,
        curve: "pasta / vesta (pallas::Base)",
        provingSystem: "IPA (halo2_proofs 0.3.2) - no trusted setup required",
        merkleDepth: MERKLE_DEPTH_HIEN_TAI,
        maxLeaves: MAX_LEAVES_HIEN_TAI
    };
}

// CSV dang DAI (long format): moi dong la MOT bang chung.
// Muc dich: Thay Co xem CSV la thay duoc bang chung, khong phai mo .json.
function csvCell(value: unknown): string {
    const text = String(value ?? "")
        .replace(/\r?\n/g, " ")
        .trim();

    return /[",;]/.test(text)
        ? "\"" + text.replace(/"/g, "\"\"") + "\""
        : text;
}

function flattenValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.length === 0
            ? "(empty)"
            : value
                .map((item) =>
                    typeof item === "object"
                        ? JSON.stringify(item)
                        : String(item)
                )
                .join(" | ");
    }

    if (value && typeof value === "object") {
        return JSON.stringify(value);
    }

    return String(value);
}

function csvTable(header: string[], rows: string[][]): string {
    return [header, ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n") + "\r\n";
}

/*
 * Trinh bay ket qua dang "DAU TICK + LY DO", khong phai `true`/`false`.
 *
 * VI SAO (2026-08-29). Cot `value` cua CSV nhieu cho chi la `true` hoac
 * `false`. Nhin mot minh KHONG biet no noi gi, va nhat la khong biet
 * TAI SAO. Thay Co doc CSV chu khong doc file .ts nay.
 *
 * Ba cot bo tro nhau, dung lan:
 *   `name`     - TEN truong
 *   `meaning`  - truong do LA GI            (bang EVIDENCE_MEANING, co dinh)
 *   `value`    - LUOT CHAY NAY ra sao + VI SAO   <- day la cho ham nay lo
 *
 * Dung `[v]` / `[x]` chu KHONG dung `true`/`false` de doc luot bang mat
 * la thay ngay dat hay khong.
 */
const TICK_YES = "✓";   // v
const TICK_NO = "✗";    // x

function tick(
    passed: boolean,
    reasonWhenPassed: string,
    reasonWhenFailed: string
): string {
    return passed
        ? TICK_YES + " " + reasonWhenPassed
        : TICK_NO + " " + reasonWhenFailed;
}

/*
 * BOM cho file CSV.
 *
 * VI SAO CAN: cac o gio co `✓` / `✗`, va tu truoc da co dau
 * gach ngang dai trong `replay_status`. Excel tren Windows mac dinh
 * doc CSV bang bang ma he thong chu KHONG phai UTF-8, nen khong co BOM
 * thi cac ky tu do hien ra rac. Them BOM la cach Excel nhan ra UTF-8.
 *
 * Khong anh huong ai doc bang code: `ConvertFrom-Csv`, `pandas` va
 * `csv` cua Node deu bo qua BOM.
 */
const CSV_BOM = "﻿";

// Tach lam BA file, theo vai tro khi doc:
//   -tieuchi.csv            5 tieu chi + TOAN BO bang chung  (file chinh)
//   -C3-rangbuoc-amount.csv rang buoc `amount` muc contract  (doi chung ADV/ONC)
//   -dieukiendo.csv         dieu kien do (C-14) + gioi han   (phu luc)
/*
 * Nghia cua tung name bang chung, de nguoi doc CSV khong phai mo code.
 *
 * VI SAO CAN: cot `value` nhieu cho la gia tri tran — `[]`, `true`,
 * `100`, `0`. Nhin mot minh khong biet no noi gi. Thay Co doc CSV chu
 * khong doc `qualitativeExperiment.ts`.
 *
 * Ten nao khong co trong bang thi cot `meaning` de trong, khong bia.
 */
const EVIDENCE_MEANING: Record<string, string> = {
    // Tieu chi 1 - chong rut lap
    usedNullifier:
        "Whether the nullifier has been spent (answered by the contract)",
    withdraw1_txHash:
        "Transaction hash of the FIRST withdrawal, verifiable on chain",
    withdraw1_status:
        "Result of the first withdrawal: 1 = success",
    replay_txHash:
        "Transaction hash of the SECOND withdrawal, same nullifier",
    replay_status:
        "Result of the second withdrawal: 0 = rejected by the contract",

    // Tieu chi 2a - truy xuat duoc (FAU_SAR.1)
    currentRoot:
        "Current Merkle root in effect, read from the contract",
    validRoot:
        "Whether the contract recognises this root as previously approved",
    transactionHash:
        "Transaction hash of the successful withdrawal",
    contractEvents:
        "Sequence of events emitted by the contract, in order",
    contractAddress:
        "ShieldedPool address - use it to look the run up again",

    // Tieu chi 2b - kiem chung duoc (NIST IR 8202 s4 p.18)
    proofVerifiedOnChain:
        "Whether the proof is checked by a contract (true) or by the"
        + " university backend (false) - read from the withdraw ABI",
    verifiedBy:
        "Who actually performs the proof check for this branch",
    commitmentPublishedOnChain:
        "Whether any contract event carries the individual commitments",
    rootReconstructibleByThirdParty:
        "Whether an outsider can rebuild the Merkle tree from chain data"
        + " alone and so confirm the root is honest",
    residualTrust:
        "What a third party must STILL take on trust after reading"
        + " everything the chain publishes",
    // 🔴 SUA 2026-09-06 cung ly do voi `residualTrust`: mo ta cu noi
    // "only the root is published, never the commitments" trong khi
    // chinh GIA TRI cua o nay in ra
    // `CommitmentsPublished(bytes32 root, bytes32[] commitments)`.
    rootPublishingEvents:
        "Full signature of every contract event - read it to see for"
        + " yourself what the chain does and does not publish",
    verifiableAxesPassed:
        "How many of the two independent axes hold: A = a third party"
        + " can re-check the proof, B = a third party can rebuild the"
        + " Merkle tree. 2 -> pass, 1 -> partial, 0 -> fail",

    // Tieu chi 3 - note ma hoa
    cid:
        "IPFS address of the note (anyone can fetch it)",
    ipfsEnvelopeFields:
        "Fields actually stored on IPFS - all of them are ciphertext",
    decrypt_correctKey:
        "Decrypting with the CORRECT key yields these fields",
    decrypt_wrongKey:
        "Decrypting with a WRONG key is rejected by AES-GCM, not garbage",

    // Tieu chi 4 - private witness
    publicSurfacesAudited:
        "Public data sources that were searched for the secrets",
    student_id_traces:
        "Traces of `student_id` found on the public surface - [] means none",
    rho_traces:
        "Traces of `rho` - [] means none",
    merklePath_traces:
        "Traces of the Merkle path (`siblings`, `directions`) - [] means none",
    studentsAudited:
        "Number of students whose secrets were searched for",
    studentsLeaked:
        "Number of students whose secrets leaked - must be 0",
    leakDetails:
        "Who leaked and what - [] means nobody leaked"
};

function buildCsvFiles(
    branch: string,
    metadata: any,
    criteria: any,
    amountBinding: Record<string, unknown>,
    limitations: Record<string, unknown>,
    fullAudit?: any
) {
    const fixedHeader = [
        "branch",
        "run_at",
        "git_commit",
        "chain_id"
    ];
    const fixed = [
        branch,
        metadata.finishedAt,
        metadata.gitCommit,
        metadata.chainId
    ];

    const criteriaRows: string[][] = [];

    for (const key of Object.keys(criteria)) {
        const criterion = criteria[key];

        for (const [name, value] of Object.entries(
            criterion.evidence
        )) {
            criteriaRows.push([
                ...fixed,
                key.split("_")[0],
                criterion.name,
                criterion.verdict,
                name,
                flattenValue(value),
                EVIDENCE_MEANING[name] || ""
            ]);
        }
    }

    const c3Rows = Object.entries(amountBinding || {}).map(
        ([name, value]) => [
            ...fixed,
            name,
            flattenValue(value)
        ]
    );

    const appendixRows = [
        ...Object.entries(metadata.measurementConditions || {}).map(
            ([name, value]) => [
                ...fixed,
                "measurement conditions (C-14)",
                name,
                flattenValue(value)
            ]
        ),
        ...Object.entries(limitations || {}).map(
            ([name, value]) => [
                ...fixed,
                "limitations - NOT proven here",
                name,
                flattenValue(value)
            ]
        )
    ];

    return {
        criteria: csvTable(
            [
                ...fixedHeader,
                "criterion",
                "criterion_name",
                "verdict",
                "evidence_name",
                "value",
                "meaning"
            ],
            criteriaRows
        ),
        amountBinding: csvTable(
            [...fixedHeader, "item", "value"],
            c3Rows
        ),
        appendix: csvTable(
            [...fixedHeader, "group", "item", "value"],
            appendixRows
        ),

        /*
         * File thu 4 — MOT DONG MOT SINH VIEN. `null` khi n = 1.
         *
         * Ba file tren la "long format": moi dong mot bang chung, so
         * dong khong doi theo n. Voi n = 100 thi cau hoi tu nhien la
         * "ca 100 nguoi deu clean chu?" — ba file do khong tra loi duoc
         * bang cach dem. File nay tra loi: 100 sinh vien, 100 dong.
         */
        students: (fullAudit?.perStudent?.length || 0) > 1
            ? csvTable(
                [
                    ...fixedHeader,
                    "total_students",
                    "student_index",
                    "student_id",
                    "wallet_address",
                    "ganache_account_index",
                    "clean",
                    "exposed_name_count",
                    "exposed_value_count",
                    "exposed_names",
                    "encodings_checked",
                    "encodings_skipped"
                ],
                fullAudit.perStudent.map((x: any) => [
                    ...fixed,
                    String(fullAudit.studentsAudited),
                    String(x.index),
                    String(x.studentId ?? ""),
                    String(x.walletAddress ?? ""),
                    String(x.ganacheAccountIndex),
                    String(x.clean),
                    String(x.exposedNameCount),
                    String(x.exposedValueCount),
                    (x.exposedNames || []).join(" ") || "(khong)",
                    String(x.encodingsChecked),
                    String(x.encodingsSkipped)
                ])
            )
            : null
    };
}

function jsonSafe(value: any) {
    return JSON.parse(JSON.stringify(
        value,
        (_key, item) =>
            typeof item === "bigint"
                ? item.toString()
                : item
    ));
}

function currentGitCommit(): string | null {
    try {
        return execFileSync(
            "git",
            ["rev-parse", "HEAD"],
            {
                cwd: path.resolve(__dirname, "../../.."),
                encoding: "utf8"
            }
        ).trim();
    } catch {
        return null;
    }
}

/*
 * K8 — ghim ma nguon that su da chay, khong chi ghi mot chuoi commit.
 *
 * VAN DE CUA BAN CU: artifact chi co `gitCommit` = `git rev-parse HEAD`.
 * Neu thu muc lam viec dang co thay doi CHUA COMMIT — truong hop binh
 * thuong khi dang phat trien — thi commit do KHONG mo ta code da chay.
 * Nguoi doc artifact tuong minh checkout commit ay la tai lap duoc, thuc
 * te khong. Do la loi nghiem trong hon ca chuyen n = 1: n = 1 khai ra la
 * xong, con khong tai lap duoc thi khong khai kieu gi cho on.
 *
 * CACH SUA: ghi them trang thai cay lam viec. `clean = false` la mot LOI
 * KHAI BAO TRUNG THUC — no noi thang "luot nay khong tai lap duoc chi
 * bang commit hash", kem danh clean file da doi de nguoi doc biet doi o dau.
 */
function sourceCodeState() {
    const goc = path.resolve(__dirname, "../../..");

    const chay = (thamSo: string[]) => {
        try {
            return execFileSync(
                "git",
                thamSo,
                { cwd: goc, encoding: "utf8" }
            ).trim();
        } catch {
            return null;
        }
    };

    const commit = chay(["rev-parse", "HEAD"]);
    const branch = chay(["rev-parse", "--abbrev-ref", "HEAD"]);
    const trangThai = chay(["status", "--porcelain"]);

    if (commit === null) {
        return {
            gitCommit: null,
            branch: null,
            clean: null,
            changedFileCount: null,
            changedFiles: [],
            warning:
                "Khong doc duoc git — khong ghim duoc ma nguon."
                + " Luot chay nay KHONG tai lap duoc."
        };
    }

    const changedFiles = (trangThai || "")
        .split("\n")
        .map((dong: string) => dong.trim())
        .filter((dong: string) => dong.length > 0);

    const clean = changedFiles.length === 0;

    return {
        gitCommit: commit,
        branch,
        clean,
        changedFileCount: changedFiles.length,

        // Cat bot cho artifact khoi phinh; con so o tren moi la thu can doc.
        changedFiles: changedFiles.slice(0, 50),

        warning: clean
            ? null
            : "The working tree HAD uncommitted changes during this run."
                + " Checking out commit " + commit + " will NOT reproduce"
                + " the source code that ran. To reproduce, commit first"
                + " and run again."
    };
}

function validateConfiguration(
    config: QualitativeExperimentConfig
) {
    if (
        !config?.university?.name
        || !config.university.walletAddress
        || !config?.student?.email
        || !Number.isSafeInteger(config.student.id)
        || config.student.id <= 0
        || !config.student.walletAddress
        || !config.student.privateKey
        || !/^[1-9][0-9]*$/.test(
            config?.scholarship?.amountWei || ""
        )
        || !/^\d+$/.test(
            config?.pool?.initialFundingWei || ""
        )
    ) {
        throw new Error(
            "Qualitative experiment configuration is incomplete"
        );
    }
}

async function runQualitativeExperiment(
    config: QualitativeExperimentConfig,
    outputDirectory = path.resolve(
        __dirname,
        "../../../experiments/results/qualitative"
    )
) {
    validateConfiguration(config);
    const startedAt = new Date();

    /*
     * K7 (doi 2026-08-20) — LAY VI TU GANACHE, giong dinh luong.
     *
     * Ghi de `config.university` va `config.student` bang vi suy tu
     * mnemonic cua Ganache. Lam TRUOC moi thu khac de neu Ganache sai
     * mnemonic / thieu tai khoan thi dung ngay, chua kip reset database.
     *
     * `wrongPrivateKey` GIU NGUYEN tu config: no la key CO Y sai, dung
     * de chung minh giai ma that bai (tieu chi 3). No khong can — va
     * khong duoc — la mot vi Ganache.
     */
    /*
     * Khoa `run.soSinhVien` doi ten thanh `run.studentCount` ngay
     * 2026-08-23. Neu config con khoa cu thi `studentCount` la undefined
     * => `|| 1` => chay 1 sinh vien MA KHONG BAO GI. Da gap that
     * 2026-08-24: dat 100 nhung chay ra 1.
     *
     * Nen NEM LOI thay vi am tham chay sai. Ket qua sai ma khong biet
     * con te hon la khong chay duoc.
     */
    if ((config.run as any)?.soSinhVien !== undefined) {
        throw new Error(
            "Config con dung khoa CU `run.soSinhVien`. Doi thanh"
            + " `run.studentCount` (doi name 2026-08-23). Gia tri dang"
            + " co: " + (config.run as any).soSinhVien
        );
    }

    const requestedStudentCount = Math.max(
        1,
        Math.trunc(config.run?.studentCount || 1)
    );
    const requiredAccountCount = Math.max(
        STUDENT_ACCOUNT_OFFSET + requestedStudentCount,
        config.pool?.sponsorWalletAddress
            ? SPONSOR_ACCOUNT_INDEX + 1
            : 0
    );

    await assertGanacheAccounts(requiredAccountCount);

    const schoolWallet = walletFromMnemonic(SCHOOL_ACCOUNT_INDEX);
    const student0Wallet = walletFromMnemonic(STUDENT_ACCOUNT_OFFSET);

    config.university.walletAddress = schoolWallet.address;
    config.university.privateKey = schoolWallet.privateKey;
    config.student.walletAddress = student0Wallet.address;

    // Chi ghi de khi config CO bat sponsor. Bo trong thi giu nguyen
    // y nghia "khong nap them", runner bo qua buoc do nhu truoc.
    if (config.pool?.sponsorWalletAddress) {
        config.pool.sponsorWalletAddress =
            walletFromMnemonic(SPONSOR_ACCOUNT_INDEX).address;
    }
    config.student.privateKey = student0Wallet.privateKey;

    if (config.university.privateKey) {
        process.env.UNIVERSITY_PRIVATE_KEY =
            config.university.privateKey;
    }

    const databaseReset = config.run?.resetDatabase
        ? await resetExperimentDatabaseGuarded()
        : null;

    let university;

    try {
        university = await createUniversityController(
            config.university.name,
            config.university.walletAddress
        );
    } catch (error: any) {
        if (/already exists/i.test(error?.message || "")) {
            throw new Error(
                "Database thi nghiem da co du lieu tu luot chay truoc"
                + " (University.name va walletAddress la unique toan"
                + " cuc). Dat \"run\": { \"resetDatabase\": true }"
                + " trong file config de runner tu don truoc moi luot."
                + " Loi goc: " + error.message
            );
        }

        throw error;
    }
    /*
     * K6 — dung san hai phong ban truoc khi duyet.
     * CTSV-01 = Phong Cong tac Sinh vien
     * KHTC-01 = Phong Ke hoach - Tai chinh
     */
    const staff = await seedDefaultStaffController(
        university._id.toString()
    );

    /*
     * A23 — nap dataset dung chung TRUOC khi tao sinh vien dau tien.
     * `null` = tu sinh nhu cu.
     */
    const soSinhVien = Math.max(
        1,
        Math.trunc(config.run?.studentCount || 1)
    );
    const datasetRows = config.run?.useSharedDataset
        ? docDatasetDungChung(soSinhVien)
        : null;

    /*
     * A23 — ma sinh vien cung phai lay tu dataset, khong chi `amount`
     * va `rho`.
     *
     * VI SAO. `commitment = Poseidon3(student_id, amount, rho)`. Neu
     * `student_id` khac thi commitment khac, la cay khac, la root khac —
     * bai KHONG duoc noi hai thuc nghiem "cung dau vao" nua du `rho` da
     * trung. Truoc khi sua, dinh tinh chay `24560001` con dinh luong
     * chay `24560000`.
     *
     * CHI GAN MOT DONG LA DU: `deriveExtraStudents` sinh sinh vien thu i
     * bang `baseStudent.id + i`, va dataset danh so lien tuc tu
     * `students[0].student_id` (da kiem: dung voi ca 7 file n). Nen dat
     * lai goc thi ca day khop theo.
     */
    if (datasetRows) {
        config.student.id = datasetRows[0].studentId;
        config.student.email = datasetRows[0].studentId + "@gmail.com";
    }

    await createStudentProfileController(
        university._id.toString(),
        staff.STUDENT_AFFAIRS,
        config.student.id,
        config.student.email
    );

    await approveEligibilityController(
        university._id.toString(),
        staff.STUDENT_AFFAIRS,
        config.student.id,
        "approve"
    );
    await approveFinanceController(
        university._id.toString(),
        staff.FINANCE,
        config.student.id,
        // A23 — so tien lay tu dataset neu bat dung chung.
        datasetRows ? datasetRows[0].amountWei : config.scholarship.amountWei
    );

    /*
     * V1(b) — CUONG CHE MENH GIA cho lượt chay nay (2026-09-02).
     *
     * Moi sinh vien trong dataset deu cung mot muc tien (da kiem 7/7 file),
     * nen truyen chinh muc do vao lam `denomination`. Hop dong se TU CHOI
     * moi lan nop sai muc.
     *
     * VI SAO PHAI LAM: `RFC 6973 muc 3.3` doi tap an danh gom nhung ca the
     * "have the same attributes". Truoc thay doi nay, dieu kien "cung menh
     * gia" chi dat NHO DU LIEU tinh co dong nhat — khong co gi trong he
     * ngan mot lan trien khai cap moi nguoi mot muc. Nay hop dong chan
     * that, va `denomination()` doc nguoc duoc tu chuoi lam bang chung.
     */
    const menhGiaCuongChe = datasetRows
        ? datasetRows[0].amountWei
        : config.scholarship.amountWei;

    const pool = await createPoolController(
        university._id.toString(),
        staff.FINANCE,
        undefined,
        undefined,
        String(menhGiaCuongChe)
    );
    const deployment = await deployPoolController(
        pool._id.toString(),
        staff.FINANCE,
        config.pool.initialFundingWei,
        config.university.privateKey
    );

    // Sponsor nap them la BUOC TUY CHON: thieu mot trong hai truong thi
    // runner bo qua, pool chi co tien tu luc deploy. Giu dung dieu kien
    // nhu ONC de hai repo cung mot khuon config.
    if (
        config.pool.sponsorWalletAddress
        && config.pool.sponsorAmountWei
    ) {
        await fundPoolController(
            pool._id.toString(),
            staff.FINANCE,
            config.pool.sponsorAmountWei,
            config.pool.sponsorWalletAddress
        );
    }

    const studentPublicKey =
        derivePublicKeyFromPrivateKey(
            config.student.privateKey
        );
    await registerStudentWalletController(
        university._id.toString(),
        staff.STUDENT_AFFAIRS,
        pool._id.toString(),   // A22 — chuong trinh nao
        config.student.email,
        config.student.walletAddress,
        studentPublicKey
    );

    const scholarship = await issueScholarshipController(
        university._id.toString(),
        staff.STUDENT_AFFAIRS,
        config.student.id,
        // A23 — `rho` cua dataset, de note trung voi dinh luong.
        datasetRows ? datasetRows[0].rho : undefined
    );

    /*
     * K7 — phat hoc bong cho (n-1) sinh vien con lai.
     *
     * PHAI nam TRUOC `approveRootController`: root duoc duyet mot lan cho
     * ca pool, nen moi sinh vien phai co commitment trong cay TRUOC luc do.
     * Duyet root roi moi them nguoi thi ho khong chung minh duoc thanh vien.
     *
     * Sinh vien so 0 (`config.student`) da xong o tren va KHONG bi dong
     * vao — giu nguyen de artifact khong doi hinh dang.
     */
    const studentCount = soSinhVien;

    const extraStudents = deriveExtraStudents(
        studentCount - 1,
        {
            id: config.student.id,
            email: config.student.email,
            privateKey: config.student.privateKey
        }
    );

    const hocBongPhu: {
        students: typeof extraStudents[number];
        cid: string;
    }[] = [];

    /*
     * Boc `retry` quanh TUNG SINH VIEN (them 2026-09-02).
     *
     * Day dung la cho luot ONC `n = 500` chet ngay 02/09: sau ~500 vong,
     * Atlas bau lai primary va nem `ReplicaSetNoPrimary`, ca luot chay
     * mat trang. Moi vong mo roi dong mot ket noi toi cum cloud, nen
     * cang nhieu sinh vien cang de dinh.
     *
     * Boc o MUC MOT SINH VIEN chu khong boc ca vong lap: thu lai ca vong
     * lap se tao lai nhung sinh vien da tao xong => `E11000` trung khoa.
     */
    for (const sv of extraStudents) {
        await retry(
            "sinh vien " + sv.id,
            async () => {
            await boQuaNeuDaLam(
                () => createStudentProfileController(
                university._id.toString(),
                staff.STUDENT_AFFAIRS,
                sv.id,
                sv.email
                )
            );
            await approveEligibilityController(
                university._id.toString(),
                staff.STUDENT_AFFAIRS,
                sv.id,
                "approve"
            );
            await approveFinanceController(
                university._id.toString(),
                staff.FINANCE,
                sv.id,
                // A23 — sinh vien thu i lay so tien cua dong i trong dataset.
                datasetRows
                    ? datasetRows[sv.index].amountWei
                    : config.scholarship.amountWei
            );
            await boQuaNeuDaLam(
                () => registerStudentWalletController(
                university._id.toString(),
                staff.STUDENT_AFFAIRS,
                pool._id.toString(),   // A22 — chuong trinh nao
                sv.email,
                sv.walletAddress,
                derivePublicKeyFromPrivateKey(sv.privateKey)
                )
            );

            const hocBong = await issueScholarshipController(
                university._id.toString(),
                staff.STUDENT_AFFAIRS,
                sv.id,
                datasetRows ? datasetRows[sv.index].rho : undefined
            );

            hocBongPhu.push({
                students: sv,
                cid: hocBong.encryptedNoteCid
            });
            }
            ,

            /*
             * 8 lan thay vi 4 (2026-09-05).
             *
             * Mac dinh 4 lan cho tong cong 3+6+12 = 21 giay, ma chinh chu
             * thich cua `retry` ghi "Atlas bau lai primary co the mat 10-30
             * giay". Luot ONC n = 500 chet o sinh vien 24560115 dung vi het
             * luot thu trong khi Atlas van chua len lai.
             *
             * 8 lan cho 3+6+12+24+48+96+192 = 381 giay — du cho mot dot bau
             * lai dai, va van chiu thua neu Atlas that su hong.
             */
            8
        );
    }

    const rootApproval = await approveRootController(
        pool._id.toString(),
        staff.STUDENT_AFFAIRS
    );

    const cid = scholarship.encryptedNoteCid;
    const encryptedEnvelope = await readEncryptedNote(cid);
    const decryptedNote = await getStudentFromIpfs(
        cid,
        config.student.privateKey
    );
    const configuredWrongKey =
        config.student.wrongPrivateKey
        || "22".repeat(32);
    const wrongPrivateKey =
        configuredWrongKey.toLowerCase()
        !== config.student.privateKey.toLowerCase()
            ? configuredWrongKey
            : "11".repeat(32);
    let wrongKeyRejected = false;
    let wrongKeyError: string | null = null;

    try {
        await getStudentFromIpfs(cid, wrongPrivateKey);
    } catch (error: any) {
        wrongKeyRejected = true;
        wrongKeyError = error?.message || String(error);
    }

    const request = await createWithdrawalRequestController({
        cid,
        note: decryptedNote
    });
    // Do so du TRUOC va SAU khi rut - bang chung tien that su chuyen,
    // manh hon co `status = 1` don thuan.
    const web3 = getWeb3();
    const poolAddressForBalance = deployment.pool.contractAddress;
    const soDuSinhVienTruoc = String(
        await web3.eth.getBalance(config.student.walletAddress)
    );
    const soDuPoolTruoc = String(
        await web3.eth.getBalance(poolAddressForBalance)
    );

    // Doc usedNullifier TRUOC khi rut, de bang chung la "false -> true"
    // chu khong phai mot chu `true` khong ro doi tu dau.
    const usedNullifierTruoc = String(
        await getShieldedPoolContract(deployment.pool.contractAddress)
            .methods
            .usedNullifier(String(request.expectedNullifier
                || request.nullifier))
            .call()
    );

    const executedRequest = await reviewWithdrawalRequestController(
        request._id.toString(),
        staff.FINANCE,
        "approve"
    );

    const soDuSinhVienSau = String(
        await web3.eth.getBalance(config.student.walletAddress)
    );
    const soDuPoolSau = String(
        await web3.eth.getBalance(poolAddressForBalance)
    );

    const contractAddress = deployment.pool.contractAddress;
    const contract = getShieldedPoolContract(contractAddress);
    const transactionHash = executedRequest.transactionHash;
    const receipt = await web3.eth.getTransactionReceipt(
        transactionHash
    );
    const transaction = await web3.eth.getTransaction(
        transactionHash
    );
    const events = await contract.getPastEvents("allEvents", {
        fromBlock: 0,
        toBlock: "latest"
    });

    let replay: any = {
        rejected: false,
        transactionHash: null,
        receipt: null,
        reason: null
    };

    try {
        await reviewWithdrawalRequestController(
            request._id.toString(),
            staff.FINANCE,
            "approve"
        );
    } catch (error: any) {
        replay = {
            rejected: true,
            transactionHash:
                error?.receipt?.transactionHash
                || error?.transactionHash
                || null,
            receipt: error?.receipt
                ? jsonSafe(error.receipt)
                : null,
            reason:
                error?.reason
                || error?.cause?.message
                || error?.message
                || String(error)
        };
    }

    /*
     * K7 — giai ma va rut cho (n-1) sinh vien con lai.
     *
     * PHAI nam TRUOC khi dung `publicArtifact`: be mat cong khai duoc soi
     * o tieu chi 4 gom `events` va `contractState`, nen n giao dich rut
     * phai xay ra XONG thi phep soi moi co y nghia. Soi khi moi co mot
     * giao dich thi khong the phat hien loai ro ri chi lo khi nhieu note
     * cung nam trong mot cay — do dung la thu K7 sinh ra de bat.
     *
     * Test replay va test sai khoa chi chay tren sinh vien so 0: chung la
     * tinh chat cua CONTRACT va cua DINH DANG PHONG BI, lap lai n lan chi
     * cho ra cung mot boolean.
     */
    const biMatSinhVienPhu: {
        student_id: any;
        rho: any;
    }[] = [];

    /*
     * V2 — xao tron TRUOC vong giai ngan.
     *
     * `hocBongPhu` dang xep theo dung thu tu nop don. Giai ngan theo thu
     * tu do thi vi tri tren chuoi = vi tri nop don, va kenh thu tu ho
     * toang. Xao tron xong thi hai cot khong con lien he.
     */
    const seedXaoTron = Number(
        config.run?.shuffleSeed ?? 20260905
    );

    const thuTuGiaiNgan = xaoTron(
        hocBongPhu.map((x: any, i: number) => ({ item: x, viTriNop: i })),
        seedXaoTron
    );

    /*
     * Doi chieu HAI COT: vi tri nop don vs vi tri tren chuoi.
     *
     * `viTriNop`  — thu tu sinh vien nop don (chi so goc trong danh sach)
     * `viTriChuoi`— thu tu giao dich len chuoi (chi so trong vong lap nay)
     *
     * Hai cot trung nhau o BAO NHIEU cho chinh la do do cua kenh thu tu.
     * Hoan vi ngau nhien dung thi ky vong chi 1 cho trung, bat ke n.
     */
    const doiChieuThuTu: {
        studentId: any;
        viTriNop: number;
        viTriChuoi: number;

        /*
         * Dia chi nhan — de sau vong lap DOI CHIEU voi su kien tren
         * chuoi. Khong co truong nay thi `viTriChuoi` chi la SO SACH
         * cua runner, khong ai kiem lai duoc.
         */
        walletAddress: string;
    }[] = [];

    let viTriChuoi = 0;

    for (const { item, viTriNop } of thuTuGiaiNgan) {
        const noteCuaHo = await getStudentFromIpfs(
            item.cid,
            item.students.privateKey
        );

        biMatSinhVienPhu.push({
            student_id: noteCuaHo.student_id,
            rho: noteCuaHo.rho
        });

        const yeuCau = await createWithdrawalRequestController({
            cid: item.cid,
            note: noteCuaHo
        });

        await reviewWithdrawalRequestController(
            yeuCau._id.toString(),
            staff.FINANCE,
            "approve"
        );

        doiChieuThuTu.push({
            studentId: item.students.id,
            viTriNop,
            viTriChuoi,
            walletAddress: String(item.students.walletAddress || "")
        });

        viTriChuoi += 1;
    }

    /*
     * So cho HAI COT TRUNG NHAU. Day la con so noi len kenh thu tu con
     * ho hay da bit:
     *   = n  => khong xao tron, kenh HO HOAN TOAN
     *   ~ 1  => hoan vi ngau nhien dung, kenh DA BIT
     */
    const soChoTrungThuTu = doiChieuThuTu.filter(
        (x) => x.viTriNop === x.viTriChuoi
    ).length;

    /*
     * Lay LAI event sau khi tat ca da rut.
     *
     * `events` o tren chup luc moi co sinh vien so 0 rut xong. Neu dung
     * ban do de soi thi bo sot dung phan ma K7 them vao — n giao dich rut
     * cua nhung nguoi con lai. Voi n = 1 thi hai lan chup cho ket qua
     * giong het nhau, nen khong anh huong ban cu.
     */
    const eventsSauCung = extraStudents.length > 0
        ? await contract.getPastEvents("allEvents", {
            fromBlock: 0,
            toBlock: "latest"
        })
        : events;

    /*
     * ===================================================================
     * KENH LIEN KET cua `R4` — DO TU CHUOI, khong tu so sach runner
     * ===================================================================
     *
     * VI SAO CO KHOI NAY (them 2026-09-10).
     *
     * `viTriChuoi` o tren la BIEN DEM VONG LAP. No dung *neu* moi lan
     * gui deu len chuoi dung thu tu vong lap. Nhung runner co `retry`
     * boc tung sinh vien — va luot ADV `n = 500` ngay 05/09 DA dinh
     * retry that o sinh vien 24560039. Mot lan thu lai co the doi thu
     * tu gui ma so sach khong biet.
     *
     * ⇒ Chi tin so sach la tin runner TU KHAI. O day dem lai bang SU
     * KIEN TREN CHUOI — con so quan sat vien tu doc duoc.
     *
     * Ba thuoc do khac cung lay tu day, deu la kenh cua `R4`:
     *   `walletReuseObserved`          kenh VI
     *   `maxWithdrawalsPerBlock`       kenh VI TRI BLOCK
     *   `blockOrderMatchesChainOrder`  kenh VI TRI BLOCK
     *
     * 🔴 VI TRI BLOCK KHONG PHAI THOI GIAN DONG HO. Ganache chay
     * instamine (moi giao dich mot block), va timestamp o day chi phan
     * anh toc do vong lap runner chu khong phai lich giai ngan cua
     * truong. Dung viet "da do kenh thoi gian".
     */
    const suKienRut = (eventsSauCung || [])
        .filter((e: any) => e?.event === "Withdraw");

    const viTheoChuoi = new Map<string, number>();
    const demTheoBlock = new Map<number, number>();

    let soLanTrungVi = 0;
    let blockDonDieu = true;
    let blockTruoc = -1;

    suKienRut.forEach((e: any, i: number) => {
        const nguoiNhan = String(e?.returnValues?.recipient || "")
            .toLowerCase();

        if (viTheoChuoi.has(nguoiNhan)) {
            // Mot dia chi nhan tien lan thu hai => ghep duoc hai lan rut.
            soLanTrungVi += 1;
        } else {
            viTheoChuoi.set(nguoiNhan, i);
        }

        const b = Number(e?.blockNumber);

        demTheoBlock.set(b, (demTheoBlock.get(b) || 0) + 1);

        if (blockTruoc >= 0 && b < blockTruoc) {
            blockDonDieu = false;
        }

        blockTruoc = b;
    });

    /*
     * Sinh vien so 0 rut TRUOC vong lap nen chiem vi tri dau tren
     * chuoi. Cac sinh vien phu bat dau tu vi tri 1 => tru 1 de hai
     * thuoc do cung mot goc toa do.
     */
    const viTriSinhVien0 = viTheoChuoi.get(
        String(config.student.walletAddress || "").toLowerCase()
    );

    let soDoiChieuTuChuoi = 0;
    let soTrungTuChuoi = 0;

    for (const x of doiChieuThuTu) {
        const vt = viTheoChuoi.get(
            String(x.walletAddress || "").toLowerCase()
        );

        if (vt === undefined) {
            continue;
        }

        soDoiChieuTuChuoi += 1;

        if (x.viTriNop === vt - 1) {
            soTrungTuChuoi += 1;
        }
    }

    const nhieuNhatMoiBlock = demTheoBlock.size === 0
        ? 0
        : Math.max(...Array.from(demTheoBlock.values()));

    const expectedRoot = String(request.expectedRoot);
    const expectedNullifier = String(
        request.expectedNullifier
    );
    const publicArtifact = {
        proofOutput: {
            proof: request.proof,
            root: expectedRoot,
            nullifier: expectedNullifier,
            amount: request.amountWei,

            /*
             * A25 — public input THU 4. Truoc 13/09 khoi nay dat cung ba
             * truong nen artifact trong nhu mach 3 input. Proof ADV khong
             * len chuoi va `proof_bytes` giu nguyen 3 104 B qua A25, nen
             * day la noi DUY NHAT trong artifact ADV ghi ro vi nhan da
             * rang buoc vao proof. Vi nhan cong khai, KHONG phai bi mat.
             */
            recipient: String(request.recipient || "")
        },
        transactionInput: transaction.input,
        contractInterface: contract.options.jsonInterface,
        events: jsonSafe(eventsSauCung),
        contractState: {
            currentRoot: await contract.methods
                .currentRoot()
                .call(),
            validRoot: await contract.methods
                .validRoot(expectedRoot)
                .call(),

            /*
             * V1(b) — doc NGUOC menh gia tu chinh hop dong (2026-09-02).
             *
             * Day la bang chung cho ve "same attributes" cua `R1`
             * (RFC 6973 muc 3.3). Doc tu chuoi chu khong lay tu config:
             * config noi y DINH cuong che, con o day noi hop dong THAT SU
             * dang cuong che muc nao. `0` = khong cuong che.
             */
            denomination: String(
                await contract.methods
                    .denomination()
                    .call()
            ),
            usedNullifier: await contract.methods
                .usedNullifier(expectedNullifier)
                .call()
        }
    };
    const chainId = BigInt(
        await web3.eth.getChainId()
    ).toString();

    // Gia tri bi mat that, de kiem ro ri theo GIA TRI chu khong chi theo TEN.
    // `amount` KHONG nam day: no la public input co chu y.
    const privateValues = {
        student_id: decryptedNote.student_id,
        rho: decryptedNote.rho
    };
    const leakage = privateWitnessLeakageCheck(
        publicArtifact,
        privateValues
    );

    /*
     * K7 — soi be mat cong khai voi bi mat cua TAT CA n sinh vien.
     *
     * `leakage` o tren chi soi bi mat cua sinh vien so 0. Voi n = 1 do la
     * toan bo, nhung voi n > 1 thi no bo sot dung cai dang muon kiem: be
     * mat cong khai gio chua n commitment va n giao dich rut, va cau hoi
     * that su la "co note nao trong so n bi lo khong", chu khong phai
     * "note dau tien co bi lo khong".
     *
     * Soi tung nguoi rieng biet chu khong gop chung mot lan: gop lai thi
     * neu co ro ri se khong biet ro ri cua AI.
     */
    const perStudentAudit = [
        { index: 0, biMat: privateValues, ketQua: leakage },
        ...biMatSinhVienPhu.map((biMat, i) => ({
            index: i + 1,
            biMat,
            ketQua: privateWitnessLeakageCheck(
                publicArtifact,
                biMat
            )
        }))
    ];

    const soNguoiBiLo = perStudentAudit.filter(
        (x: any) => !x.ketQua.passed
    ).length;

    const fullAudit = {
        studentsAudited: perStudentAudit.length,
        studentsLeaked: soNguoiBiLo,
        allClean: soNguoiBiLo === 0,

        // Chi liet ke nguoi BI LO. Sach thi khong can liet ke ai.
        leakDetails: perStudentAudit
            .filter((x: any) => !x.ketQua.passed)
            .map((x: any) => ({
                index: x.index,
                exposedNames: x.ketQua.exposedNames,
                exposedValues: x.ketQua.exposedValues
            })),

        /*
         * Mot dong cho MOI sinh vien — ke ca nguoi clean.
         *
         * `leakDetails` o tren chi liet ke nguoi bi lo, nen khi tat ca
         * deu clean no rong, khong doc duoc gi. Mang nay de xuat ra CSV
         * "mot dong mot sinh vien": n = 100 thi 100 dong, dem tay duoc.
         *
         * CO Y khong ghi `student_id` va `rho` vao day. Chung la witness
         * bi mat; ghi ra file ket qua roi copy sang paper/ la tu tay pha
         * dung bat bien ma tieu chi 4 dang chung minh.
         */
        perStudent: perStudentAudit.map((x: any) => ({
            index: x.index,
            // Chi so tai khoan Ganache, giong `ganache_account_index`
            // cua `dataset_n*.json` ben dinh luong => doi chieu duoc.
            ganacheAccountIndex: STUDENT_ACCOUNT_OFFSET + x.index,
            // Ma sinh vien + dia chi vi: khong co hai cot nay thi doc
            // CSV chi thay `index 0,1,2...` ma khong biet la AI, va
            // khong tra nguoc duoc ve `event Withdraw` tren chain.
            // KHONG ghi private key — day la file ket qua se copy sang paper/.
            studentId: x.index === 0
                ? config.student.id
                : extraStudents[x.index - 1]?.id,
            walletAddress: x.index === 0
                ? config.student.walletAddress
                : extraStudents[x.index - 1]?.walletAddress,
            clean: x.ketQua.passed,
            exposedNameCount: x.ketQua.exposedNames.length,
            exposedValueCount: x.ketQua.exposedValues.length,
            exposedNames: x.ketQua.exposedNames,
            encodingsChecked:
                x.ketQua.coverage?.checkedEncodingCount || 0,
            encodingsSkipped:
                x.ketQua.coverage?.skippedTooShort?.length || 0
        })),

        // Cong don pham vi da soi de bao cao trung thuc: moi sinh vien
        // duoc do bao nhieu cach ma hoa, va bao nhieu cach bi bo qua.
        totalEncodingsChecked: perStudentAudit.reduce(
            (tong: number, x: any) =>
                tong + (x.ketQua.coverage?.checkedEncodingCount || 0),
            0
        ),
        totalEncodingsSkipped: perStudentAudit.reduce(
            (tong: number, x: any) =>
                tong
                + (x.ketQua.coverage?.skippedTooShort?.length || 0),
            0
        )
    };

    // Envelope tren IPFS khong duoc chua gia tri ro, khong chi la khong
    // chua TEN truong (gioi han da ghi o `00_contributions.md` muc C5).
    const envelopeLeakage = privateWitnessLeakageCheck(
        encryptedEnvelope,
        privateValues
    );
    const ciphertextOnly = envelopeLeakage.passed;

    const proofBoundOnChain = withdrawBindsProofOnChain(
        publicArtifact.contractInterface
    );
    const rootPublishedOnChain =
        publicArtifact.contractState.validRoot === true;
    const eventNames = publicArtifact.events.map(
        (item: any) => item.event
    );

    // === Nam tieu chi dinh tinh cua outline muc 2.1.3 ===
    //
    // 2a — TRUY XUAT DUOC. Dat khi CA NAM thu ma C-8 liet ke deu doc
    // duoc tu contract. Day la phep do CU, giu nguyen cong thuc.
    const stateReadable =
        Boolean(publicArtifact.contractState.currentRoot)
        && publicArtifact.contractState.validRoot === true
        && publicArtifact.contractState.usedNullifier !== null
        && publicArtifact.contractState.usedNullifier !== undefined
        && Boolean(transactionHash)
        && eventNames.length > 0;

    /*
     * === 2b — KIEM CHUNG DUOC (them 2026-08-29, theo T5.A) ===
     *
     * VI SAO TACH LAM DOI. Outline muc 2.1.3 goi tieu chi nay la
     * "Tinh minh bach VA kha nang kiem chung" — HAI truc. Nhung dieu
     * kien dat cua no chi noi "co the truy xuat", tuc chi do MOT truc.
     *
     * ISO/IEC 15408-2 (CC:2022) tach dung hai dong tu nay ra HAI LOP:
     *     FAU_SAR.1    "read" / "interpret"   -> TRUY XUAT DUOC  (2a)
     *     FCO_NRO.1.3  "verify"               -> KIEM CHUNG DUOC (2b)
     * Gop mot o la nhap nhang co ma so chung minh.
     *
     * Nghia "kiem chung" ma bai dung KHONG lay tu CC — Cowork da grep
     * toan van 297 trang, khong ma so nao phu dung nghia "ben thu ba
     * bat ky tu xac minh trang thai so cai". Lay tu NIST IR 8202 muc 4
     * tr.18 (DOI 10.6028/NIST.IR.8202):
     *
     *     "there is no need to have a trusted third party provide the
     *      state of the system - every user within the system can
     *      verify the system's integrity"
     *
     * HAU QUA NEU KHONG TACH: ADV verify o backend nha truong, ONC
     * verify tren chuoi. Do la khac biet LON NHAT giua hai nhanh —
     * dung thu dong gop C2 noi toi — ma `2_transparency` cu cham CA
     * HAI GIONG HET NHAU. Loi nam o PHEP DO, khong phai o he thong.
     *
     * Hai dieu kien, doc tu ABI chu khong hard-code theo repo, de mot
     * ban code chay dung tren ca hai nhanh:
     */

    // (1) Proof co duoc kiem TREN CHUOI khong?
    //     ADV: withdrawOffChain(...) khong nhan proof  -> false
    //     ONC: withdraw(..., proof)                    -> true
    const proofVerifiedOnChain = proofBoundOnChain;

    /*
     * (2) Ben thu ba co dung lai duoc cay Merkle khong?
     *
     * `RootUpdated(bytes32 root)` phat MOI root — commitment chua bao
     * gio len chuoi (kiem 2026-08-29: ADV ShieldedPool.sol:28,
     * ONC :62). Nen ben thu ba kiem duoc "proof hop le doi voi root R"
     * nhung KHONG kiem duoc "R chi chua hoc bong cap hop le".
     *
     * Do tu ABI chu khong viet cung `false`: neu sau nay contract co
     * emit commitment that thi o nay tu chuyen sang true, khong ai
     * phai nho sua tay o day.
     */
    const commitmentPublishedOnChain =
        (publicArtifact.contractInterface || []).some(
            (item: any) =>
                item.type === "event"
                && (item.inputs || []).some(
                    (input: any) =>
                        /commitment|leaf/i.test(input.name || "")
                )
        );

    /*
     * `M4` — chay phep dung lai cay. Xem chu thich cua
     * `dungLaiGocTuSuKien`. Re: chi bam ~1 023 node Poseidon.
     */
    const kiemDungLaiGoc = dungLaiGocTuSuKien(
        eventsSauCung,
        publicArtifact.contractState.currentRoot
    );

    if (kiemDungLaiGoc) {
        console.error(
            "  M4 dung lai cay: " + String(kiemDungLaiGoc.leafCount)
            + " commitment -> goc "
            + (kiemDungLaiGoc.matches ? "KHOP" : "LECH")
            + " voi currentRoot"
        );
    }

    /*
     * Thang ba muc — dung DUNG thang cua Outline 2.1.3
     * ("dat / dat mot phan / khong dat"), khong tu che thang moi.
     *
     * HAI TRUC DOC LAP, dem xem dat may truc:
     *   truc A: proof kiem duoc boi ben thu ba  (co verifier tren chuoi)
     *   truc B: root kiem duoc boi ben thu ba   (commitment len chuoi)
     *
     *   2 truc -> dat            : khong con phai tin nha truong o cho nao
     *   1 truc -> dat mot phan   : niem tin bi DAY LUI mot buoc
     *   0 truc -> khong dat      : phai tin nha truong hoan toan
     *
     * VI SAO DEM TRUC chu khong xep tang (sua 2026-08-29): hai truc nay
     * DOC LAP nhau. Ban truoc bat buoc phai co truc A moi duoc len
     * "dat mot phan", nen mot nhanh cong bo commitment ma verify
     * off-chain se bi cham "khong dat" — dung ra phai la "dat mot phan"
     * vi no CO cho ben thu ba them mot thu kiem duoc. Dem truc thi cong
     * bang voi ca hai chieu.
     */
    const verifiableAxes = [
        proofVerifiedOnChain,
        commitmentPublishedOnChain
    ].filter(Boolean).length;

    const stateVerifiableVerdict =
        verifiableAxes === 2
            ? DAT
            : verifiableAxes === 1
                ? DAT_MOT_PHAN
                : KHONG_DAT;

    // Tra ve DAU VET TIM DUOC tren be mat cong khai, dang mang.
    //   []                      = khong tim thay gi  -> bang chung clean
    //   ["rho","rho=123..."]    = co ro ri, liet ke ra
    // In thang ket qua audit, khong dien giai bang loi van.
    /*
     * Dau vet gom tu TAT CA n sinh vien, khong chi sinh vien 0.
     *
     * Truoc day ham nay chi doc `leakage` (= sinh vien 0), trong khi
     * `verdict` cua tieu chi 4 lai tinh tren `fullAudit` (= ca n nguoi).
     * Voi n > 1 hai cho lech nhau: sinh vien 57 bi lo thi ket luan thanh
     * "khong dat" nhung dan chung van hien `[]` — file tu mau thuan.
     *
     * Voi n = 1 gia tri ra Y HET nhu truoc (chi co mot nguoi trong mang),
     * nen khong vo tham chieu nao cua `draft/4_experiments.md`.
     *
     * Nguoi bi lo duoc ghi kem chi so (`sv3:rho=...`) — biet AI lo moi
     * lan nguoc ve note duoc, chu dem so luong thi khong dieu tra duoc.
     */
    const traces = (...name: string[]) => JSON.stringify(
        perStudentAudit.flatMap((sv: any) => {
            const nhan = perStudentAudit.length > 1
                ? "sv" + sv.index + ":"
                : "";

            return [
                ...sv.ketQua.exposedNames
                    .filter((n: string) => name.includes(n))
                    .map((n: string) => nhan + n),
                ...sv.ketQua.exposedValues
                    .filter((x: any) => name.includes(x.label))
                    .map(
                        (x: any) =>
                            nhan + x.label + "=" + x.encoding
                    )
            ];
        })
    );

    // Bang chung bam sat cot "Ket qua can thu thap" cua Outline.md 2.1.3:
    //   TC1 : usedNullifier + ket qua HAI giao dich
    //   TC2a: currentRoot, validRoot, usedNullifier, tx hash, events
    //   TC2b: ai kiem proof, commitment co len chuoi khong, con phai
    //         tin ai — tach ra tu TC2 ngay 2026-08-29, xem T5.A
    //   TC3 : noi dung tren IPFS + ket qua giai ma
    //   TC4 : du lieu cong khai trong verification va tren blockchain
    const criteria = {
        "1_replay_prevention": {
            name: "Replay prevention",
            verdict:
                Boolean(receipt?.status)
                && replay.rejected
                && publicArtifact.contractState.usedNullifier === true
                    ? DAT
                    : KHONG_DAT,
            evidence: {
                usedNullifier:
                    usedNullifierTruoc
                    + " (before withdrawal) -> "
                    + String(
                        publicArtifact.contractState.usedNullifier
                    )
                    + " (after withdrawal)",
                withdraw1_txHash: transactionHash,
                withdraw1_status: receipt?.status
                    ? "1 - transaction accepted by the EVM"
                    : "0 - transaction reverted by the EVM",
                replay_txHash: replay.transactionHash,
                replay_status: replay.receipt
                    ? String(replay.receipt.status)
                        + " — "
                        + (
                            String(replay.reason || "")
                                .split("{")[0] || ""
                        ).trim()
                    : String(replay.reason || "(no receipt)")
            }
        },
        "2a_state_readable": {
            name: "State is readable (ISO/IEC 15408-2 FAU_SAR.1)",
            verdict: stateReadable ? DAT : KHONG_DAT,
            evidence: {
                // Gia tri tho - day la ban than du lieu, khong phai
                // ket luan dat/khong, nen KHONG gan tick.
                currentRoot: publicArtifact.contractState.currentRoot,
                transactionHash,
                contractEvents: eventNames.join(" | "),

                // Hai o duoi la KET LUAN dat/khong -> tick + ly do.
                validRoot: tick(
                    publicArtifact.contractState.validRoot === true,
                    "the contract confirms this root was approved earlier,"
                        + " so anyone can check the withdrawal used a"
                        + " root the university had published",
                    "the contract does not recognise this root - a reader"
                        + " cannot tie the withdrawal to an approved root"
                ),
                usedNullifier: tick(
                    publicArtifact.contractState.usedNullifier === true,
                    "the contract reports this nullifier as spent, so the"
                        + " spend is visible to any reader",
                    "the contract reports this nullifier as unspent - the"
                        + " spend left no readable trace"
                )
            }
        },
        "2b_state_verifiable": {
            name: "State is verifiable without trusting the issuer"
                + " (NIST IR 8202 s4 p.18)",
            verdict: stateVerifiableVerdict,
            evidence: {
                // === TRUC A: proof co kiem duoc boi ben thu ba khong ===
                proofVerifiedOnChain: tick(
                    proofVerifiedOnChain,
                    "the withdraw function takes the proof as calldata and"
                        + " a contract verifies it, so a third party can"
                        + " re-run the check without trusting anyone",
                    "the withdraw function takes no proof, so proof"
                        + " validity is asserted by the university backend"
                        + " and cannot be rechecked from chain data"
                ),
                verifiedBy: proofVerifiedOnChain
                    ? "on-chain verifier contract"
                    : "university backend (off-chain)",

                // === TRUC B: root co kiem duoc boi ben thu ba khong ===
                commitmentPublishedOnChain: tick(
                    commitmentPublishedOnChain,
                    "a contract event carries the individual commitments",
                    "no contract event carries commitments - only the"
                        + " Merkle root is published"
                ),
                /*
                 * 🔴 SUA 2026-09-12. Truoc day o nay = `commitmentPublishedOnChain`,
                 * tuc CUNG MOT bien — hai o bang chung la MOT phep do hien hai
                 * lan, va nhan o nay khang dinh "rebuild duoc" trong khi chua he
                 * bam lai. Nay lay ket qua DUNG LAI THAT.
                 */
                rootReconstructibleByThirdParty: tick(
                    kiemDungLaiGoc?.matches === true,
                    "an outsider rebuilt the tree from the "
                        + String(kiemDungLaiGoc?.leafCount ?? 0)
                        + " published commitments and got the same root the"
                        + " contract reports",
                    kiemDungLaiGoc
                        ? "an outsider rebuilt the tree but got a DIFFERENT"
                            + " root - investigate before quoting anything"
                        : "no rebuild was performed this run (no"
                            + " CommitmentsPublished event, or the prover"
                            + " could not be called)"
                ),

                // Dem truc, de nguoi doc thay verdict tu dau ra.
                verifiableAxesPassed:
                    String(verifiableAxes) + " of 2"
                    + " (A: proof re-checkable | B: root re-buildable)",

                /*
                 * Cau tra loi cho "con phai tin ai": viet ra thanh loi,
                 * vi day la ket qua AM va no de bi doc luot qua.
                 *
                 * 🔴 SUA 2026-09-06. Ban cu chi re nhanh theo TRUC A
                 * (`proofVerifiedOnChain`). Khi V4 them su kien
                 * `CommitmentsPublished`, `commitmentPublishedOnChain`
                 * TU chuyen sang true — dung nhu comment o tren du
                 * lieu — nhung cau nay thi khong ai sua tay, nen ONC in
                 * ra "only the root is published" ngay canh hai o da
                 * ghi "✓ carries the individual commitments". Mot cau
                 * tu mau thuan voi bang chung cua chinh no.
                 *
                 * Nay tinh tu CA HAI truc ⇒ khong the lech lai duoc.
                 */
                residualTrust: proofVerifiedOnChain
                    ? (
                        commitmentPublishedOnChain
                            ? "nothing beyond the chain itself - a"
                                + " contract re-checks the proof and"
                                + " the commitments are published, so"
                                + " both axes are open to a third party"
                            : "the set of commitments inside the root -"
                                + " only the root is published, so a"
                                + " third party cannot check the tree"
                                + " was built from legitimately issued"
                                + " scholarships"
                    )
                    : (
                        commitmentPublishedOnChain
                            ? "proof validity - the withdraw function"
                                + " takes no proof, so the university"
                                + " backend asserts it; the commitment"
                                + " set itself is re-buildable from"
                                + " chain data"
                            : "the whole withdrawal - neither the proof"
                                + " nor the commitment set can be"
                                + " rechecked from chain data"
                    ),

                rootPublishingEvents: (
                    publicArtifact.contractInterface || []
                )
                    .filter((item: any) => item.type === "event")
                    .map((item: any) =>
                        item.name
                        + "("
                        + (item.inputs || [])
                            .map((i: any) => i.type + " " + i.name)
                            .join(", ")
                        + ")"
                    )
                    .join(" | ")
            }
        },
        "3_encrypted_note": {
            name: "Encrypted note on IPFS",
            verdict:
                ciphertextOnly && wrongKeyRejected
                    ? DAT
                    : KHONG_DAT,
            evidence: {
                cid,
                ipfsEnvelopeFields:
                    Object.keys(encryptedEnvelope).join(" | "),
                decrypt_correctKey:
                    Object.keys(decryptedNote || {}).join(" | "),
                decrypt_wrongKey: wrongKeyError
            }
        },
        "4_private_witness": {
            name: "Private witness",

            // K7: voi n > 1, dat CHI KHI ca n sinh vien deu clean.
            // Mot nguoi bi lo la tieu chi nay khong dat, du (n-1) nguoi
            // con lai clean — do moi la nghia dung cua "witness khong lo".
            verdict: fullAudit.allClean ? DAT : KHONG_DAT,

            evidence: {
                publicSurfacesAudited: "public inputs | calldata | events | contract state",
                student_id_traces: traces("student_id"),
                rho_traces: traces("rho"),
                merklePath_traces:
                    traces("siblings", "directions"),

                /*
                 * K7 — ba dong nay CHI xuat hien khi n > 1.
                 *
                 * VI SAO PHAI CO DIEU KIEN: `buildCsvFiles` trai
                 * `evidence` thanh MOI DONG MOT TRUONG, nen them ba
                 * truong la `-tieuchi.csv` tu 18 thanh 21 dong. Con so
                 * "5 · 5 · 4 · 4 = 18 dong" dang duoc khang dinh o SAU
                 * cho, trong do HAI file da nam trong
                 * `paper/input/results/` — ngoai tam sua cua repo nay.
                 *
                 * Voi n = 1: khong them gi, CSV van dung 18 dong, moi
                 * tai lieu cu van dung.
                 * Voi n > 1: CSV la file MOI (`-n<so>-`), chua tai lieu
                 * nao noi no bao nhieu dong, nen them thoai mai.
                 */
                ...(studentCount > 1
                    ? {
                        studentsAudited: fullAudit.studentsAudited,
                        studentsLeaked: fullAudit.studentsLeaked,
                        leakDetails:
                            JSON.stringify(fullAudit.leakDetails)
                    }
                    : {})
            }
        }
    };

    const finishedAt = new Date();
    const result = jsonSafe({
        metadata: {
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs:
                finishedAt.getTime() - startedAt.getTime(),
            gitCommit: currentGitCommit(),

            // K8 — ghim ma nguon that su da chay.
            // `gitCommit` o tren giu nguyen name va nguyen y nghia cho
            // ban cu; khoi duoi bo sung trang thai cay lam viec, thu
            // quyet dinh luot chay nay CO tai lap duoc hay khong.
            sourceCode: sourceCodeState(),

            // K7 — quy mo luot chay. n = 1 la mac dinh, giong ban cu.
            studentCount,

            chainId,
            contractAddress,
            databaseReset,
            measurementConditions: measurementConditions()
        },
        ipfs: {
            cid,
            encryptedEnvelope,
            ciphertextOnly,
            envelopeLeakage,
            correctKeyDecrypted: true,
            wrongKeyRejected,
            wrongKeyError
        },
        proof: {
            root: expectedRoot,
            nullifier: expectedNullifier,
            amount: String(request.amountWei),
            localVerificationPassed:
                request.localVerificationPassed
        },
        withdrawal: {
            firstAttempt: {
                succeeded: Boolean(receipt?.status),
                transactionHash,
                receipt: jsonSafe(receipt)
            },
            replay,
            contractState: publicArtifact.contractState,
            events: publicArtifact.events
        },
        rootApproval: {
            root: String(rootApproval.candidateRoot),
            transactionHash: rootApproval.transactionHash,
            currentRoot: publicArtifact.contractState.currentRoot,
            validRoot: publicArtifact.contractState.validRoot
        },
        privacy: {
            ...leakage,
            inspectedPublicArtifact: publicArtifact
        },

        // K7 — phep soi mo rong cho ca n sinh vien.
        // Khoi RIENG, khong tron vao `privacy`: `draft/4_experiments.md`
        // dang trich `privacy.coverage.serializedBytes`, doi hinh dang
        // khoi do la vo cac tham chieu da viet.
        publicSurfaceAudit_K7: fullAudit,
        // Ket qua cham theo dung outline muc 2.1.3, nhung tieu chi 2
        // da TACH lam 2a/2b (2026-08-29, T5.A) -> 5 khoa.
        qualitativeCriteria_2_1_3: criteria,
        // C3 cua `00_contributions.md` - gach 4: "thi nghiem cho thay
        // GIOI HAN cua ADV". KHONG thuoc thang cham cua 5 tieu chi.
        /*
         * V2 — KENH THU TU cua `R4` (them 2026-09-05).
         *
         * Do TREN HE THAT: 500 giao dich rut di qua `onlySchool` voi
         * nonce that. Khac test don vi `withdrawOrderChannel.test.ts`
         * von chi kiem ham xao tron chay dung.
         *
         * `matchingPositions` la con so quyet dinh:
         *   = n  => giai ngan theo dung thu tu nop => kenh HO HOAN TOAN
         *   ~ 1  => hoan vi ngau nhien dung => kenh DA BIT
         * Ky vong ly thuyet cua hoan vi ngau nhien la 1, bat ke n.
         */
        withdrawOrderChannel_R4: {
            shuffleEnabled: true,
            shuffleSeed: seedXaoTron,
            withdrawalsCompared: doiChieuThuTu.length,
            matchingPositions: soChoTrungThuTu,
            expectedIfRandom: 1,
            verdict: doiChieuThuTu.length === 0
                ? "n_too_small"
                : soChoTrungThuTu <= Math.max(1, doiChieuThuTu.length * 0.05)
                    ? "pass"
                    : "fail",
            meaning: "so cho vi tri nop don trung vi tri tren chuoi."
                + " Bang n nghia la thu tu tren chuoi lo nguyen thu tu nop don",
            sample: doiChieuThuTu.slice(0, 10),

            /*
             * DOI CHUNG doc lap: dem lai bang su kien tren chuoi thay vi
             * bien dem vong lap. Hai con so phai KHOP nhau.
             *
             * 🔴 Lech nhau la PHAT HIEN THAT, khong duoc bo qua: nghia
             * la thu tu gui len chuoi khac thu tu runner ghi so — vi du
             * do mot lan `retry` chen vao giua.
             */
            crossCheckFromChain: {
                withdrawalsCompared: soDoiChieuTuChuoi,
                matchingPositions: soTrungTuChuoi,
                agreesWithRunnerBookkeeping:
                    soDoiChieuTuChuoi === doiChieuThuTu.length
                    && soTrungTuChuoi === soChoTrungThuTu,
                meaning: "dem tu su kien Withdraw tren chuoi."
                    + " `agreesWithRunnerBookkeeping = false` nghia la so"
                    + " sach cua runner KHONG khop chuoi - phai dieu tra"
            }
        },

        /*
         * Hai kenh con lai cua `R4`, do TRONG luot chay nay.
         * Xem khoi chu thich "KENH LIEN KET cua R4" o tren.
         */
        linkabilityChannels_R4: {
            walletReuseObserved: soLanTrungVi,
            walletReuseMeaning: "so lan MOT dia chi nhan tien tu lan thu"
                + " hai tro di. Bang 0 la khong ghep duoc hai lan rut qua"
                + " vi. Chan vinh vien giua nhieu pool la A21 o tang CSDL,"
                + " chung minh boi test chu khong boi luot chay nay",

            maxWithdrawalsPerBlock: nhieuNhatMoiBlock,
            distinctBlocks: demTheoBlock.size,
            withdrawEventsObserved: suKienRut.length,
            blockOrderMatchesChainOrder: blockDonDieu,
            blockPositionMeaning: "thu tu block don dieu theo thu tu giao"
                + " dich => VI TRI BLOCK khong mang them thong tin nao"
                + " ngoai THU TU, ma thu tu da xao tron."
                + " KHONG phai phep do thoi gian dong ho:"
                + " tren chuoi thu nghiem timestamp chi phan anh toc do"
                + " vong lap runner",
            scope: "mot pool = mot dot cap hoc bong"
        },

        /*
         * `M4` — bang chung DUNG LAI CAY. Xem chu thich cua
         * `dungLaiGocTuSuKien`.
         */
        rootRebuildCheck_M4: kiemDungLaiGoc
            ? {
                leafCount: kiemDungLaiGoc.leafCount,
                rebuiltRoot: kiemDungLaiGoc.rebuiltRoot,
                onChainRoot: kiemDungLaiGoc.onChainRoot,
                rebuiltRootMatchesOnChain: kiemDungLaiGoc.matches,
                method: "commitments taken from the CommitmentsPublished"
                    + " event, hashed by the prover `root` mode, compared"
                    + " with `currentRoot` read from the contract",
                usesNoPrivateWitness: true
            }
            : {
                rebuiltRootMatchesOnChain: false,
                reason: "no rebuild performed this run"
            },

        amountBindingAtContract_C3: {
            withdrawTakesProof: tick(
                proofBoundOnChain,
                "the withdraw function has a proof/bytes parameter",
                "the withdraw function has no proof parameter"
            ),
            contractReadsAmountFromProof: tick(
                proofBoundOnChain,
                "the contract decodes `amount` from the proof's public"
                    + " inputs and compares it with the argument",
                "the contract has no proof to decode, so it cannot compare"
            ),
            closedBinding: tick(
                proofBoundOnChain,
                "the `amount` binding is CLOSED at contract level",
                "the `amount` binding is guaranteed by the backend ONLY,"
                    + " not closed at contract level"
            ),
            conclusion: proofBoundOnChain
                ? "The contract DOES take the proof, decodes `amount` from the"
                    + " public inputs and compares it with the `amount` argument."
                    + " The `amount` binding is CLOSED at contract level."
                : "The contract does NOT take the proof, so it cannot read"
                    + " `amount` from the public inputs and cannot compare it with"
                    + " the `amount` argument. The `amount` binding is guaranteed by"
                    + " the backend only, NOT closed at contract level.",
            verificationEvidence: "none - ADV has no proof at contract level, so there is no require to test",
            contributionRef: "C3 - item 4: the experiment shows the limitation of ADV",
            caution: "Must NOT be written as if the two mechanisms give the same"
                + " security guarantee."
        },
        // Nhung dieu thi nghiem nay KHONG chung minh.
        limitations: {
            // K7 (2026-08-20) da tong quat hoa runner sang n sinh vien,
            // nen KHONG duoc viet cung 1 nua. Lay tu quy mo luot chay that.
            studentsInPool: studentCount,
            impact:
                "This run built " + String(studentCount) + " students in the"
                + " pool. Even so, NONE of the 5 criteria measures ANONYMITY"
                + " (the central claim of C1): the 5 criteria score replay"
                + " prevention, readable state, verifiable state,"
                + " ciphertext-only storage and"
                + " private-witness secrecy - none of them asks whether an"
                + " observer can tell who withdrew. Anonymity evidence lives in"
                + " table B, condition R1 of THIS SAME RUN"
                + " (`-B-riengtu.csv`): `anonymitySetFromChain`,"
                + " `distinctRecipients` and `distinctAmounts`, all counted"
                + " from on-chain events."
                + " - The anonymity set is an UPPER BOUND and holds ONLY"
                + " because the contract enforces one denomination"
                + " (V1(b)); with mixed amounts it does not.",
            runCount: 1,
            notForPerformance:
                "These numbers are a single sample with no standard deviation."
                + " Official performance numbers belong to sections 6/7.",
            amountAndRecipientArePublic:
                "The Withdraw event emits `recipient` and `amount` in clear."
                + " The system hides the LINK between a payout and a note,"
                + " not the payout itself.",

            /*
             * Hai dong duoi them 2026-08-29 theo T5.A. Ca hai deu la
             * ket qua AM doi chieu voi ISO/IEC 15408-2 lop FPR — phai
             * di kem so lieu, khong duoc de reviewer tu phat hien.
             */

            // FPR_UNO.1 — KHONG dat va KHONG THE dat. Day la danh doi
            // co chu y, khong phai thieu sot: chinh su cong khai cua
            // `Withdraw` la thu TAO RA tinh minh bach o tieu chi 2a.
            unobservabilityNotClaimed:
                "ISO/IEC 15408-2 FPR_UNO.1 (unobservability) is NOT met and"
                + " CANNOT be met by design: withdrawals are public events."
                + " This is the deliberate trade-off that produces criterion"
                + " 2a. Do not present it as a defect, and do not cite"
                + " FPR_UNO.4 in support of transparency - its wording says"
                + " `authorized user`, which is the opposite axis.",

            /*
             * 🔴 SUA 2026-09-10. Ban truoc ghi "evidence comes from the
             * SEPARATE measurement C-13" — nhung `experiments/results/
             * anonymity/` RONG o ca hai repo: runner an danh da quyet
             * dinh KHONG chay (05/09), va `R5` bo khoi pham vi bai cung
             * ngay. File ket qua hua mot thu bang chung khong ton tai.
             */
            collusionOutOfScope:
                "ISO/IEC 15408-2 FPR_UNL.1 (Annex I.4.2.2) requires"
                + " unlinkability against COOPERATING users. That condition"
                + " (R5) was taken OUT OF SCOPE on 2026-09-05: it is an"
                + " EXAMPLE in a CC annex rather than a core requirement,"
                + " and with only a few withdrawers the anonymity set barely"
                + " shrinks. Closing it needs a reference threshold that has"
                + " not been found yet (gap T5-D). It is NOT pending work"
                + " and NO measurement of it exists - do not cite one.",

            // Ranh gioi cua chuan: cho nao muon duoc, cho nao khong.
            standardsBoundary:
                "Criteria 1, 3 and 4 are NOT graded against any external"
                + " standard - they are properties of this system's own"
                + " mechanisms and the experiment proves them directly."
                + " Criterion 2a borrows ISO/IEC 15408-2 FAU_SAR.1 only to"
                + " name the `read` axis; criterion 2b takes its definition"
                + " from NIST IR 8202 s4 p.18 because no Common Criteria"
                + " component covers `any third party verifies ledger state"
                + " without trusting the operator`."
        }
    });

    fs.mkdirSync(outputDirectory, { recursive: true });
    const timestamp = finishedAt
        .toISOString()
        .replace(/[:.]/g, "-");
    /*
     * K7 dieu 1 — KHONG duoc ghi de artifact n = 1 dang co.
     *
     * Ban n = 1 la bang chung dinh tinh DUY NHAT dang co: da copy sang
     * `paper/input/results/qualitative_offchain/` va `draft/4_experiments.md`
     * dang trich thang ten truong cua no (`closedBinding`, `skippedTooShort`,
     * `replay_status`, ...). Chay hong ma da ghi de la mat trang.
     *
     * Nen: n > 1 ghi ra name CO HAU TO `-n<so>`. Doi tên la viec cua ban,
     * sau khi da doi chieu xong — khong phai viec cua runner.
     */
    const nSuffix = studentCount > 1
        ? `-n${studentCount}`
        : "";

    const outputPath = path.join(
        outputDirectory,
        `qualitative${nSuffix}-${timestamp}.json`
    );
    fs.writeFileSync(
        outputPath,
        JSON.stringify(result, null, 2),
        "utf8"
    );

    const csvBase = outputPath.replace(/\.json$/, "");
    const csvFiles = buildCsvFiles(
        "off-chain (ADV)",
        result.metadata,
        criteria,
        result.amountBindingAtContract_C3,
        result.limitations,
        result.publicSurfaceAudit_K7
    );
    const csvPaths: Record<string, string> = {
        criteria: csvBase + "-tieuchi.csv",
        amountBinding: csvBase + "-C3-rangbuoc-amount.csv",
        appendix: csvBase + "-dieukiendo.csv"
    };

    if (csvFiles.students) {
        csvPaths.students = csvBase + "-sinhvien.csv";
    }

    // CSV_BOM: khong co no thi Excel doc `✓` / `✗` ra rac. Xem chu
    // thich tai cho khai bao CSV_BOM.
    fs.writeFileSync(
        csvPaths.criteria,
        CSV_BOM + csvFiles.criteria,
        "utf8"
    );
    fs.writeFileSync(
        csvPaths.amountBinding,
        CSV_BOM + csvFiles.amountBinding,
        "utf8"
    );
    fs.writeFileSync(
        csvPaths.appendix,
        CSV_BOM + csvFiles.appendix,
        "utf8"
    );

    if (csvFiles.students && csvPaths.students) {
        fs.writeFileSync(
            csvPaths.students,
            CSV_BOM + csvFiles.students,
            "utf8"
        );
    }

    /*
     * Hai CSV minh chung cho bang A (minh bach) va bang B (rieng tu).
     *
     * Doc lai chinh file JSON vua ghi chu khong dung bien trong bo nho —
     * de dam bao CSV va JSON KHONG THE lech nhau, va de cung mot ham do
     * chay lai duoc tren cac luot da chay xong (`npx ts-node
     * src/experiments/tinhChatChuanCsv.ts <file.json>`).
     */
    const tinhChatPaths = writeStandardPropertyCsvs(
        "off-chain (ADV)",
        outputPath
    );

    csvPaths.transparency = tinhChatPaths.transparency;
    csvPaths.privacy = tinhChatPaths.privacy;

    return {
        outputPath,
        csvPaths,
        result
    };
}

module.exports = {
    runQualitativeExperiment
};
