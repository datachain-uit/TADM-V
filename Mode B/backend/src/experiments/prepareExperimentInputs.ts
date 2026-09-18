const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");
const { HDNodeWallet } = require("ethers");
const { performance } = require("perf_hooks");

/*
 * Sinh mot ban ghi sinh vien cho dataset thuc nghiem.
 *
 * Truoc 2026-08-30 file nay import `createExperimentStudentRecord` tu
 * `services/generateStudentFile`, nhung module do KHONG export ten nay
 * (chi co computeCommitment / computeMerkleRoot / computeNullifier /
 * generateStudentFile / normalizeBytes32) => resolve ra `undefined` va
 * `npm run experiment:prepare` chet ngay dong goi dau tien.
 *
 * Dat ham ngay tai day thay vi them export ben kia: no CHI phuc vu viec
 * sinh dataset, khong thuoc luong that.
 *
 * Schema phai TRUNG TUNG TRUONG voi 6 dataset da co (dataset_n*.json),
 * vi 3 muc n = 1 / 10 / 100 duoc dung lai nguyen ven. Chu y `amount`
 * trong `note` la SO, khong phai chuoi.
 */
const {
    createStudentNote,
    uploadToIpfs,
    derivePublicKeyFromPrivateKey
} = require("../clients/ipfs/ipfsClient");

async function createExperimentStudentRecord(
    studentIndex: number,
    studentId: number,
    amount: number,
    privateKey: string,
    address: string
) {
    const publicKey =
        derivePublicKeyFromPrivateKey(
            privateKey
        );

    const note =
        createStudentNote(
            studentId,
            amount
        );

    // `createStudentNote` tra `amount` dang chuoi; dataset cu luu SO.
    note.amount = amount;

    const cid =
        await uploadToIpfs(
            note,
            publicKey
        );

    return {
        student_index: studentIndex,
        address,
        student_id: studentId,
        amount,
        private_key: privateKey,
        public_key: publicKey,
        cid,
        note
    };
}

// =========================
// WEB3 / GANACHE
// =========================

const web3 =
    new Web3(
        "http://127.0.0.1:8545"
    );

// Phải trùng với mnemonic khi chạy Ganache
const GANACHE_MNEMONIC =
    process.env.GANACHE_MNEMONIC ||
    "test test test test test test test test test test test junk";

// accounts[0] là school
// accounts[1], accounts[2], ... là student
const STUDENT_ACCOUNT_OFFSET =
    1;

// =========================
// PATHS
// =========================

const PROJECT_ROOT =
    path.resolve(
        __dirname,
        "../../.."
    );

const DATA_DIR =
    path.resolve(
        PROJECT_ROOT,
        "experiments/data"
    );

fs.mkdirSync(
    DATA_DIR,
    {
        recursive: true
    }
);

// =========================
// EXPERIMENT CONFIG
// =========================

const SCENARIOS =
    [1, 10, 30, 60, 100, 353, 500];

const MERKLE_DEPTH =
    9;

const SCHOLARSHIP_AMOUNT =
    2;

// =========================
// GANACHE WALLET HELPER
// =========================
//
// Chỉ lấy private key từ Ganache account.
// Không tạo rho ở đây.
// Không encrypt/decrypt ở đây.
//

function getGanacheWalletByIndex(
    index: number
) {
    const derivationPath =
        `m/44'/60'/0'/0/${index}`;

    const wallet =
        HDNodeWallet.fromPhrase(
            GANACHE_MNEMONIC,
            undefined,
            derivationPath
        );

    return {
        index,
        address: wallet.address,
        privateKey: wallet.privateKey
    };
}

async function assertGanacheAccountMatches(
    accountIndex: number,
    derivedAddress: string
) {
    const accounts =
        await web3.eth.getAccounts();

    const ganacheAddress =
        accounts[accountIndex];

    if (!ganacheAddress) {
        throw new Error(
            `Ganache account index ${accountIndex} not found. Start Ganache with --wallet.totalAccounts 501`
        );
    }

    if (
        ganacheAddress.toLowerCase() !==
        derivedAddress.toLowerCase()
    ) {
        throw new Error(
            [
                "Ganache account does not match derived mnemonic wallet.",
                `accountIndex=${accountIndex}`,
                `ganacheAddress=${ganacheAddress}`,
                `derivedAddress=${derivedAddress}`,
                "Make sure Ganache is started with the same mnemonic:",
                GANACHE_MNEMONIC
            ].join("\n")
        );
    }
}

// =========================
// PREPARE ONE SCENARIO
// =========================

async function prepareScenario(
    n: number
) {
    const outputPath =
        path.resolve(
            DATA_DIR,
            `dataset_n${n}.json`
        );

    /*
     * KHOA BAO VE — KHONG ghi de dataset da co.
     *
     * Moi lan sinh lai cho ra `rho` ngau nhien MOI (crypto.randomBytes(31)).
     * Neu ghi de n = 1 / 10 / 100 thi bo so ben ONC lech han ben ADV, va bai
     * bao MAT cau "hai nhanh dung cung dau vao" cho toan bo phan dinh luong.
     *
     * Muon sinh lai that su thi phai xoa file bang tay, VA sinh lai o CA HAI
     * repo tu cung mot lan chay (sinh o mot ben roi copy sang ben kia).
     */
    if (fs.existsSync(outputPath)) {
        console.log(
            `\nBO QUA n = ${n} — dataset da ton tai: ${outputPath}`
            + "\n  (xoa file bang tay neu that su muon sinh lai;"
            + " nho copy sang repo con lai de giu claim 'cung dau vao')"
        );
        return;
    }

    console.log(
        `\nPreparing experiment dataset n = ${n}`
    );

    const students = [];

    for (let i = 0; i < n; i++) {
        const studentId =
            24560000 + i;

        const ganacheAccountIndex =
            STUDENT_ACCOUNT_OFFSET + i;

        const ganacheWallet =
            getGanacheWalletByIndex(
                ganacheAccountIndex
            );

        await assertGanacheAccountMatches(
            ganacheAccountIndex,
            ganacheWallet.address
        );

        const tPrepare =
            performance.now();

        const studentRecord =
            await createExperimentStudentRecord(
                i,
                studentId,
                SCHOLARSHIP_AMOUNT,
                ganacheWallet.privateKey,
                ganacheWallet.address
            );

        const preparationMs =
            performance.now() - tPrepare;

        students.push({
            ...studentRecord,
            ganache_account_index: ganacheAccountIndex,
            preparation_ms: preparationMs
        });

        console.log(
            [
                `student_index=${i}`,
                `ganache_account=${ganacheAccountIndex}`,
                `address=${ganacheWallet.address}`,
                `student_id=${studentId}`,
                `preparation_ms=${preparationMs.toFixed(3)}`,
                `cid=${studentRecord.cid}`
            ].join(", ")
        );
    }

    const dataset =
        {
            n,
            merkle_depth: MERKLE_DEPTH,
            school_account_index: 0,
            student_account_offset: STUDENT_ACCOUNT_OFFSET,
            students
        };

    fs.writeFileSync(
        outputPath,
        JSON.stringify(
            dataset,
            null,
            2
        )
    );

    console.log(
        `Saved: ${outputPath}`
    );
}

// =========================
// MAIN
// =========================

async function main() {
    for (const n of SCENARIOS) {
        await prepareScenario(
            n
        );
    }

    console.log(
        "\nAll experiment datasets prepared."
    );
}

main().catch(
    (error: any) => {
        console.error(error);
        process.exit(1);
    }
);  