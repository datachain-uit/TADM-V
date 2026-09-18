const {
    authorizeStaff
} = require("./authorizeStaffService");

const {
    UniversityStudent
} = require("../models/UniversityStudent");
const {
    StudentScholarship
} = require("../models/StudentScholarship");
const {
    resolveDeployedPool
} = require("../repositories/scholarshipPoolRepository");

/*
 * A22 (30/08) — PHAI noi ro dang ky vao CHUONG TRINH NAO.
 *
 * Tu A19 mot truong co NHIEU pool = nhieu chuong trinh hoc bong. Chi
 * biet `universityId` thi khong du: khong xac dinh duoc sinh vien vao
 * chuong trinh nao. `poolId` nay BAT BUOC.
 *
 * VI SAO VAN GIU `universityId`: no dung cho GAC QUYEN
 * (`authorizeStaff` chay TRUOC khi tra pool), va de KIEM CHEO rang pool
 * do that su thuoc truong do — neu khong, can bo truong A dang ky duoc
 * vao pool cua truong B.
 */
async function registerStudentWallet(
    universityId: string,
    staffId: string,
    poolId: string,
    email: string,
    walletAddress: string,
    publicKey: string
) {
    // K9 — gac vai tro.
    await authorizeStaff(universityId, staffId, "STUDENT_AFFAIRS");

    if (!universityId || !email || !walletAddress || !publicKey) {
        throw new Error(
            "universityId, email, walletAddress and publicKey are required"
        );
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
        throw new Error("Invalid Ethereum wallet address");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const universityStudent = await UniversityStudent.findOne({
        university: universityId,
        email: normalizedEmail
    });

    if (!universityStudent) {
        throw new Error(
            "University student profile not found"
        );
    }

    if (!poolId) {
        throw new Error(
            "poolId is required: a university may run several scholarship"
            + " programs, so the caller must say which pool to register into"
        );
    }

    const pool = await resolveDeployedPool(
        poolId,
        universityId
    );

    if (
        String(pool.university._id || pool.university)
        !== String(universityId)
    ) {
        throw new Error(
            "The deployed pool does not belong to this university"
        );
    }

    let scholarship = await StudentScholarship.findOne({
        pool: pool._id,
        universityStudent: universityStudent._id
    });

    if (scholarship?.commitment) {
        throw new Error(
            "Cannot change wallet after note has been issued"
        );
    }

    /*
     * A21 — MOT VI CHI DUOC DUNG CHO DUNG MOT SUAT HOC BONG.
     *
     * Index toan cuc tren `walletAddress` da chan o tang database, nhung
     * no nem `E11000 duplicate key` — nguoi dung khong hieu gi. Kiem o
     * day de bao loi doc duoc, va noi luon PHAI LAM GI.
     *
     * VI SAO CHAN: dung lai mot vi o hai chuong trinh thi quan sat vien
     * thay `0xAAA` o ca hai `event Withdraw`, giao hai tap ung vien lai
     * => tap an danh co lai. Chan vinh vien vi su kien tren chuoi khong
     * bao gio mat di.
     */
    const viDaDung = await StudentScholarship.findOne({
        walletAddress,
        ...(scholarship ? { _id: { $ne: scholarship._id } } : {})
    });

    if (viDaDung) {
        throw new Error(
            "Wallet address is already used by another scholarship"
            + " (pool " + String(viDaDung.pool) + ")."
            + " Each scholarship program needs its OWN address:"
            + " reusing one lets an observer link the two payouts"
            + " and shrinks the anonymity set. Register a NEW address."
        );
    }

    if (!scholarship) {
        scholarship = new StudentScholarship({
            pool: pool._id,
            universityStudent: universityStudent._id,
            walletAddress,
            publicKey,
            status: "WALLET_REGISTERED"
        });
    } else {
        scholarship.walletAddress = walletAddress;
        scholarship.publicKey = publicKey;
        scholarship.status = "WALLET_REGISTERED";
    }

    await scholarship.save();
    console.log(
        "\n========================\n" +
        "STUDENT WALLET REGISTERED\n" +
        "========================"
    );
    console.log("email:", universityStudent.email);
    console.log("walletAddress:", scholarship.walletAddress);
    console.log("status:", scholarship.status);

    return scholarship;
}

module.exports = {
    registerStudentWallet
};

if (require.main === module) {
    require("../cli/studentCli")
        .runRegisterStudentWalletCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
