// console.log("Starting withdraw script...");
// const { Web3 } = require("web3");
// const fs = require("fs");

// const { spawnSync } = require("child_process");
// const {
//     generateStudentFile
// } = require("./generateStudentFile");
// const web3 = new Web3(
//     "http://127.0.0.1:8545"
// );

// // =========================
// // ABI
// // =========================

// const abi = require(
//     "../../../../contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json"
// ).abi;

// // =========================
// // CONTRACT ADDRESS
// // =========================

// const CONTRACT =
//     "0x9544428BfF12cab6e6F341d4221172344b77d26B";

// // =========================
// // LOAD PROOF
// // =========================

// function loadProof() {

//     const raw = fs.readFileSync(
//         "../prover/proof.json",
//         "utf8"
//     );

//     return JSON.parse(raw);
// }


// function generateProof() {

//     const result = spawnSync(
//         "../target/release/prover",
//         [],
//         {
//             encoding: "utf8"
//         }
//     );

//     if (result.error) {
//         throw result.error;
//     }

//     if (result.status !== 0) {

//         console.error(result.stderr);

//         throw new Error(
//             "Rust prover failed"
//         );
//     }

//     // stdout từ Rust
//     const output =
//         result.stdout.trim();

//     const lines = output.split('\n');
//     const jsonLine = lines.find((line: any) => line.includes('"calldata"') || line.includes('"proof"'));

//     if (!jsonLine) {
//         console.error("--- RAW OUTPUT FROM RUST ---");
//         console.error(output);
//         throw new Error("Không tìm thấy dòng chứa dữ liệu JSON (calldata/proof)");
//     }

//     try {
//         return JSON.parse(jsonLine.trim());
//     } catch (e) {
//         console.error("Lỗi khi parse JSON:", e);
//         console.error("Dòng JSON bị lỗi:", jsonLine);
//         throw e;
//     }
//     // parse JSON
//     // return JSON.parse(output);
// }

// // =========================
// // UPDATE ROOT
// // =========================

// async function updateRoot(contract: any, root: any, from: any) {

//     console.log(
//         "\nUpdating root..."
//     );

//     const tx =
//         await contract.methods.updateRoot(
//             root
//         ).send({
//             from,
//             gas: 500000
//         });

//     console.log(
//         "ROOT UPDATED", root
//     );

//     console.log(
//         "tx hash:",
//         tx.transactionHash
//     );
// }





// function normalizeCalldata(
//     proofData: any
// ) {
//     return proofData.calldata.startsWith("0x")
//         ? proofData.calldata
//         : "0x" + proofData.calldata;
// }

// function extractRootAndNullifier(
//     proofAndSignals: string
// ) {
//     const root =
//         "0x" + proofAndSignals.slice(2, 66);

//     const nullifier =
//         "0x" + proofAndSignals.slice(66, 130);

//     return {
//         root,
//         nullifier
//     };
// }

// async function verifyProofByCall(
//     verifierAddress: string,
//     proofAndSignals: string
// ) {
//     return await web3.eth.call({
//         to: verifierAddress,
//         data: proofAndSignals
//     });
// }

// async function withdrawWithProofData(
//     contract: any,
//     proofData: any,
//     recipient: string,
//     amountWei: string,
//     from: string
// ) {
//     const proofAndSignals =
//         normalizeCalldata(
//             proofData
//         );

//     const {
//         root,
//         nullifier
//     } =
//         extractRootAndNullifier(
//             proofAndSignals
//         );

//     const tx =
//         await contract.methods.withdraw(
//             proofAndSignals,
//             root,
//             nullifier,
//             recipient,
//             amountWei
//         ).send({
//             from,
//             gas: 5000000
//         });

//     return {
//         tx,
//         proofAndSignals,
//         root,
//         nullifier,
//         gasUsed: Number(tx.gasUsed)
//     };
// }










// // =========================
// // WITHDRAW
// // =========================

// async function withdraw() {

//     // =========================
//     // ACCOUNTS FROM GANACHE
//     // =========================

//     const accounts =
//         await web3.eth.getAccounts();

//     // console.log(
//     //     "Ganache accounts:",
//     //     accounts
//     // );

//     // recipient thật
//     // const recipient = loadProof().address;
//         // accounts[1];

//     // =========================
//     // LOAD PROOF
//     // =========================

//     // const proofData =
//     //     loadProof();

//     // const proofData = loadProof();
//     const cid =
//         process.argv[2];

//     const studentPrivateKey =
//         process.argv[3];

//     let proofData;

//     if (
//         cid &&
//         studentPrivateKey
//     ) {
//         proofData =
//             await generateStudentFile(
//                 cid,
//                 studentPrivateKey
//             );
//     } else {
//         proofData =
//             loadProof();
//     }

//     // const recipient = proofData.address;
//     const recipient = accounts[2];

//     // =========================
//     // CONTRACT
//     // =========================

//     const contract =
//         new web3.eth.Contract(
//             abi,
//             CONTRACT
//         );

//     // =========================
//     // AMOUNT
//     // =========================

//     const amountWei =
//         web3.utils.toWei(
//             "0.01",
//             "ether"
//         );

//     // =========================
//     // PROOF
//     // =========================

//     // const proof =
//     //     "0x" + proofData.proof;

//     const proofAndSignals = 
//     proofData.calldata.startsWith("0x")
//         ? proofData.calldata
//         : "0x" + proofData.calldata;

//     const root =
//     "0x" + proofAndSignals.slice(2, 66);

//     const nullifier =
//         "0x" + proofAndSignals.slice(66, 130);

//     console.log(
//         "Proof root:",
//         root
//     );

//     console.log(
//         "Proof nullifier:",
//         nullifier
//     );

//     // =========================
//     // ROOT
//     // =========================

//     // const root =
//     //     proofData.root;
//     // console.log(root);

//     // const root = proofData.root;
//     // console.log("Proof root:", root);

//     await updateRoot(contract, root, accounts[0]);



//     const rootChain = await contract.methods.validRoot(root).call();
//     console.log("On-chain root:", rootChain);


//     console.log(await web3.eth.getBalance(recipient));

//     // =========================
//     // NULLIFIER
//     // =========================

//     // const nullifier =
//     //     proofData.nullifier;
    
//     const used = await contract.methods.usedNullifier(nullifier).call();
//     console.log("usedNullifier:", used);


//     const verifierAddress =
//         await contract.methods.verifier().call();

//     console.log("Verifier:", verifierAddress);

//     const result = await web3.eth.call({
//         to: verifierAddress,
//         data: proofAndSignals
//     });

//     console.log("Verifier returned:", result);

//     // const r =
//     //     await contract.methods
//     //         .testVerify(proofAndSignals)
//     //         .call();

//     //     console.log(r);

//     // =========================
//     // WITHDRAW
//     // =========================

//     try { const tx =
//         await contract.methods.withdraw(
//             proofAndSignals,
//             root,
//             nullifier,
//             recipient,
//             amountWei
//         ).send({
//             from: accounts[0],
//             gas: 5000000
//         });
    

//     console.log(
//         "\n========================"
//     );

//     console.log(
//         "WITHDRAW SUCCESS"
//     );

//     console.log(
//         "tx hash:",
//         tx.transactionHash
//     );

//     console.log(
//         "recipient:",
//         recipient
//     );


//     console.log("\nEVENTS:");

//     const withdrawEvent = tx.events?.Withdraw;

//     if (withdrawEvent) {
//         console.log("recipient:", withdrawEvent.returnValues.recipient);
//         console.log("amount:", withdrawEvent.returnValues.amount.toString());
//         console.log("nullifier:", withdrawEvent.returnValues.nullifier);
//     } else {
//         console.log("No Withdraw event found");
//     }

//     console.log("recipient (local):", recipient);
//     } catch (e: any) {
//         console.log(e.receipt);
//     }
    
// }   

// // withdraw().catch(console.error);

// if (require.main === module) {
//     withdraw().catch(console.error);
// }

// module.exports = {
//     withdraw,
//     updateRoot,
//     normalizeCalldata,
//     extractRootAndNullifier,
//     verifyProofByCall,
//     withdrawWithProofData
// };






























console.log(
    "Starting withdraw script..."
);

const {
    Web3
} = require(
    "web3"
);

const path =
    require(
        "path"
    );

/*
 * Duong dan SAU refactor 2026-08-18 (services/ -> clients/).
 *
 * File nay chuyen tu `services/withdrawService.ts` sang
 * `clients/blockchain/shieldedPoolClient.ts`, nhung `require` tuong doi
 * nay khong duoc sua theo — `./generateStudentFile` tro vao
 * `clients/blockchain/`, noi khong co file do.
 *
 * `tsc --noEmit` KHONG bat duoc vi `require` tra ve `any`. Loi chi lo ra
 * luc chay: `Cannot find module './generateStudentFile'`.
 *
 * Da lam hong `npm run experiment:gas` tu 18/08 den 21/08 ma khong ai
 * biet, vi luot gas cuoi chay ngay 16/08 — TRUOC refactor.
 */
const {
    generateStudentFile
} = require(
    "../../services/generateStudentFile"
);

/*
 * Gas cap cho loi goi Halo2Verifier — xem ghi chu o
 * createWithdrawalRequestService.ts.
 */
const VERIFIER_CALL_GAS = 3_000_000;

const web3 =
    new Web3(
        "http://127.0.0.1:8545"
    );

const artifact =
    require(
        path.resolve(
            __dirname,
            "../../../../contracts/artifacts/contracts/ShieldedPool.sol/ShieldedPool.json"
        )
    );

const abi =
    artifact.abi;

function getContractAddress() {
    const address =
        process.env
            .SHIELDED_POOL_ADDRESS;

    if (!address) {
        throw new Error(
            "Missing SHIELDED_POOL_ADDRESS"
        );
    }

    return address;
}

function normalizeCalldata(
    proofData:
        any
) {
    return proofData
        .calldata
        .startsWith(
            "0x"
        )
            ? proofData.calldata
            : `0x${proofData.calldata}`;
}

function extractPublicInputs(
    proofAndSignals:
        string
) {
    if (
        !/^0x[0-9a-fA-F]+$/
            .test(
                proofAndSignals
            )
    ) {
        throw new Error(
            "Invalid calldata hex"
        );
    }

    // 3 x 32 bytes
    if (
        proofAndSignals.length
        <
        2 + 256
    ) {
        throw new Error(
            "Calldata is too short for root, nullifier, amount and recipient"
        );
    }

    const root =
        `0x${
            proofAndSignals
                .slice(
                    2,
                    66
                )
        }`;

    const nullifier =
        `0x${
            proofAndSignals
                .slice(
                    66,
                    130
                )
        }`;

    const amountHex =
        `0x${
            proofAndSignals
                .slice(
                    130,
                    194
                )
        }`;

    const amountWei =
        BigInt(
            amountHex
        )
        .toString();

    // A25 — word thu 4 la vi nhan; dia chi la 20 byte cuoi cua word.
    const recipientWord =
        `0x${
            proofAndSignals
                .slice(
                    194,
                    258
                )
        }`;

    const recipient =
        `0x${recipientWord.slice(26)}`;

    return {
        root,
        nullifier,
        amountHex,
        amountWei,
        recipientWord,
        recipient
    };
}

async function withdraw() {
    const cid =
        process.argv[2];

    const studentPrivateKey =
        process.argv[3];

    if (
        !cid
        ||
        !studentPrivateKey
    ) {
        throw new Error(
            "Usage: npx ts-node " +
            "src/clients/blockchain/shieldedPoolClient.ts " +
            "<cid> <studentPrivateKey>"
        );
    }

    const accounts =
        await web3.eth
            .getAccounts();

    const sender =
        accounts[0];

    const recipient =
        accounts[2];

    const contract =
        new web3.eth.Contract(
            abi,
            getContractAddress()
        );

    console.log(
        "ShieldedPool:",
        getContractAddress()
    );

    console.log(
        "Sender:",
        sender
    );

    console.log(
        "Recipient:",
        recipient
    );

    // =========================
    // STEP 1:
    // READ ROOT FROM CONTRACT
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 1 - READ ROOT FROM CONTRACT"
    );

    console.log(
        "========================"
    );

    const currentRoot =
        String(
            await contract
                .methods
                .currentRoot()
                .call()
        );

    console.log(
        "currentRoot:",
        currentRoot
    );

    const zeroRoot =
        `0x${
            "00".repeat(
                32
            )
        }`;

    if (
        currentRoot
            .toLowerCase()
        ===
        zeroRoot
            .toLowerCase()
    ) {
        throw new Error(
            "currentRoot is empty. Run approveRootService.ts first."
        );
    }

    const rootIsValid =
        await contract
            .methods
            .validRoot(
                currentRoot
            )
            .call();

    console.log(
        "validRoot[currentRoot]:",
        rootIsValid
    );

    if (!rootIsValid) {
        throw new Error(
            "currentRoot is not approved"
        );
    }

    // =========================
    // STEP 2:
    // CREATE PROOF
    // AFTER ROOT EXISTS
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 2 - CREATE PROOF"
    );

    console.log(
        "ROOT ALREADY EXISTS ON CHAIN"
    );

    console.log(
        "========================"
    );

    const proofData =
        await generateStudentFile(
            cid,
            studentPrivateKey,
            currentRoot
        );

    const proofAndSignals =
        normalizeCalldata(
            proofData
        );

    const publicInputs =
        extractPublicInputs(
            proofAndSignals
        );

    console.log(
        "Proof root:",
        publicInputs.root
    );

    console.log(
        "Proof nullifier:",
        publicInputs.nullifier
    );

    console.log(
        "Proof amount hex:",
        publicInputs.amountHex
    );

    console.log(
        "Proof amount wei:",
        publicInputs.amountWei
    );

    if (
        publicInputs
            .root
            .toLowerCase()
        !==
        currentRoot
            .toLowerCase()
    ) {
        throw new Error(
            "Proof root differs from currentRoot"
        );
    }

    if (
        proofData.amount
        &&
        proofData
            .amount
            .toLowerCase()
        !==
        publicInputs
            .amountHex
            .toLowerCase()
    ) {
        throw new Error(
            "proofData.amount differs from calldata amount"
        );
    }

    const usedBefore =
        await contract
            .methods
            .usedNullifier(
                publicInputs
                    .nullifier
            )
            .call();

    console.log(
        "usedNullifier before:",
        usedBefore
    );

    // =========================
    // OPTIONAL DIRECT VERIFIER CALL
    // =========================

    const verifierAddress =
        await contract
            .methods
            .verifier()
            .call();

    console.log(
        "Verifier:",
        verifierAddress
    );

    const verifierResult =
        await web3.eth.call({
            to:
                verifierAddress,

            data:
                proofAndSignals,

            // Halo2Verifier ton ~442 800 gas; khong truyen thi
            // Ganache bao "out of gas", de chan doan nham la proof sai.
            gas:
                VERIFIER_CALL_GAS
        });

    console.log(
        "Verifier returned:",
        verifierResult
    );

    // =========================
    // STEP 3:
    // WITHDRAW
    // =========================

    console.log(
        "\n========================"
    );

    console.log(
        "STEP 3 - SEND WITHDRAW"
    );

    console.log(
        "========================"
    );

    const tx =
        await contract
            .methods
            .withdraw(
                proofAndSignals,

                publicInputs
                    .root,

                publicInputs
                    .nullifier,

                recipient,

                publicInputs
                    .amountWei
            )
            .send({
                from:
                    sender,

                gas:
                    5000000
            });

    console.log(
        "\n========================"
    );

    console.log(
        "WITHDRAW SUCCESS"
    );

    console.log(
        "========================"
    );

    console.log(
        "tx hash:",
        tx.transactionHash
    );

    const usedAfter =
        await contract
            .methods
            .usedNullifier(
                publicInputs
                    .nullifier
            )
            .call();

    console.log(
        "usedNullifier after:",
        usedAfter
    );

    const withdrawEvent =
        tx.events
            ?.Withdraw;

    if (
        withdrawEvent
    ) {
        console.log(
            "event recipient:",
            withdrawEvent
                .returnValues
                .recipient
        );

        console.log(
            "event amount:",
            withdrawEvent
                .returnValues
                .amount
                .toString()
        );

        console.log(
            "event nullifier:",
            withdrawEvent
                .returnValues
                .nullifier
        );
    }
}

if (
    require.main
    ===
    module
) {
    withdraw()
        .catch(
            (
                error:
                    any
            ) => {
                console.error(
                    "\nWITHDRAW FAILED"
                );

                console.error(
                    error
                );

                process.exit(
                    1
                );
            }
        );
}

/*
 * =========================================================
 * Ba hàm dưới đây phục vụ experiments/benchmarkGas.ts
 * =========================================================
 *
 * Trước đây chúng bị comment nhưng benchmarkGas.ts vẫn import
 * -> mục 6 và 7 (định lượng) KHÔNG chạy được. Khôi phục lại.
 *
 * Xem code/STATUS.md mục C-2…C-5.
 */

/*
 * Bọc mỏng quanh extractPublicInputs, giữ đúng tên mà
 * benchmarkGas.ts đang import. extractPublicInputs đã trả về
 * cả amountHex/amountWei nên đây chỉ là bản rút gọn.
 */
function extractRootAndNullifier(
    proofAndSignals:
        string
) {
    const {
        root,
        nullifier
    } =
        extractPublicInputs(
            proofAndSignals
        );

    return {
        root,
        nullifier
    };
}

/*
 * Gọi thẳng Halo2Verifier để đo verify gas / verify time,
 * tách khỏi giao dịch withdraw.
 *
 * LƯU Ý: web3 v4 eth.call THROW khi verifier revert bằng
 * revert(0, 0) — đã đo. Đừng đổi sang ethers provider.call,
 * nó không phản ánh được loại revert này.
 */
async function verifyProofByCall(
    verifierAddress:
        string,

    proofAndSignals:
        string
) {
    return await web3.eth.call({
        to:
            verifierAddress,

        data:
            proofAndSignals,

        gas:
            VERIFIER_CALL_GAS
    });
}

/*
 * Gửi giao dịch withdraw từ proof package, dùng cho phép đo
 * withdraw gas theo từng n.
 *
 * Ba public input lấy từ chính calldata — đúng như
 * ShieldedPool.withdraw yêu cầu (contract require chúng khớp
 * nhau trước khi gọi verifier).
 */
async function withdrawWithProofData(
    contract:
        any,

    proofData:
        any,

    recipient:
        string,

    amountWei:
        string,

    from:
        string
) {
    const proofAndSignals =
        normalizeCalldata(
            proofData
        );

    const {
        root,
        nullifier
    } =
        extractRootAndNullifier(
            proofAndSignals
        );

    return await contract
        .methods
        .withdraw(
            proofAndSignals,
            root,
            nullifier,
            recipient,
            amountWei
        )
        .send({
            from,

            gas:
                5000000
        });
}

/*
 * ===== THIET KE TACH (them 2026-08-25) =====
 *
 * `withdrawWithProofData` o tren do THIET KE GOP: mot giao dich lam ca
 * xac minh lan thanh toan. Hai ham duoi do THIET KE TACH.
 *
 * VI SAO CAN CA HAI trong runner dinh luong:
 * Gop lai thi `withdraw_gas` la MOT so, khong tach duoc bao nhieu phan
 * la xac minh va bao nhieu la thanh toan — nen khong so thang duoc voi
 * `withdrawOffChain` cua nhanh off-chain (chi lam phan thanh toan).
 * Tach ra thi `settle_gas` va `withdrawOffChain_gas` la CUNG MOT cong
 * viec, con `verify_record_gas` la dung phan gia phai tra de xac minh
 * tren chuoi. Do chinh la su danh doi ma Dong gop 2 phai chi ra.
 *
 * `withdraw` van do tiep de chung minh: tach ra KHONG lam tong chi phi
 * tang dang ke (chi them phi base 21 000 cua giao dich thu hai + chi phi
 * ghi `Claim`).
 */

async function verifyAndRecordWithProofData(
    contract:
        any,

    proofData:
        any,

    recipient:
        string,

    amountWei:
        string,

    from:
        string
) {
    const proofAndSignals =
        normalizeCalldata(
            proofData
        );

    const {
        root,
        nullifier
    } =
        extractRootAndNullifier(
            proofAndSignals
        );

    return await contract
        .methods
        .verifyAndRecord(
            proofAndSignals,
            root,
            nullifier,
            recipient,
            amountWei
        )
        .send({
            from,

            gas:
                5000000
        });
}

/*
 * 🔴 CHI truyen `nullifier`. Recipient/amount/root deu doc tu `Claim`
 *    da ghi o buoc tren — xem ShieldedPool.settle.
 */
async function settleByNullifier(
    contract:
        any,

    nullifier:
        string,

    from:
        string
) {
    return await contract
        .methods
        .settle(
            nullifier
        )
        .send({
            from,

            gas:
                5000000
        });
}

module.exports = {
    withdraw,
    normalizeCalldata,
    extractPublicInputs,
    extractRootAndNullifier,
    verifyProofByCall,
    withdrawWithProofData,
    verifyAndRecordWithProofData,
    settleByNullifier
};