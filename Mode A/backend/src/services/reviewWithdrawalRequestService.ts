const {
    connectDatabase,
    disconnectDatabase
} = require(
    "../config/database"
);
const {
    universityIdOf
} = require("../utils/universityRef");

const {
    UniversityStudent
} = require(
    "../models/UniversityStudent"
);

const {
    StudentScholarship
} = require(
    "../models/StudentScholarship"
);

const {
    WithdrawalRequest
} = require(
    "../models/WithdrawalRequest"
);

const {
    normalizeBytes32,
    decimalToBytes32
} = require(
    "../utils/bytes32"
);

const {
    verifyProofOffChain
} = require(
    "./generateStudentFile"
);

const {
    assertPoolUniversity,
    getPoolBalance,
    getShieldedPoolContract,
    resolveSender
} = require(
    "../clients/blockchain/shieldedPoolClient"
);

require(
    "../models/ScholarshipPool"
);

const {
    authorizeStaff,
    ROLE_LABEL
} = require("./authorizeStaffService");

/*
 * Buoc chi tien — thuoc Phong Ke hoach - Tai chinh.
 * `staffId` bat buoc: xem code/DECISIONS.md muc C5.
 */
async function reviewWithdrawalRequest(
    requestId:
        string,

    staffId:
        string,

    decision:
        "approve"
        |
        "reject"
) {
    await connectDatabase();

    const request:
        any =
        await WithdrawalRequest
            .findById(
                requestId
            )
            .populate({
                path:
                    "scholarship",

                populate: {
                    path:
                        "universityStudent"
                }
            })
            .populate(
                "pool"
            );

    if (!request) {
        throw new Error(
            "Withdrawal request not found"
        );
    }

    /*
     * PENDING_APPROVAL:
     * request chưa được nhà trường xử lý.
     *
     * EXECUTION_FAILED:
     * nhà trường đã approve nhưng transaction
     * blockchain gặp lỗi, được phép thử lại.
     *
     * EXECUTED:
     * cho phép gửi lại cùng request để contract
     * tự chặn nullifier đã dùng và revert on-chain.
     */
    if (
        ![
            "PENDING_APPROVAL",
            "EXECUTION_FAILED",
            "EXECUTED"
        ].includes(
            request.status
        )
    ) {
        throw new Error(
            "Request cannot be reviewed. " +
            `Current status: ${request.status}`
        );
    }

    const isReplayAttempt =
        request.status
        ===
        "EXECUTED";

    if (
        isReplayAttempt
        &&
        decision
        ===
        "reject"
    ) {
        throw new Error(
            "An executed request cannot be rejected"
        );
    }

    const scholarship =
        request.scholarship;

    const pool =
        request.pool;

    /*
     * Kiem vai tro SAU khi co pool, vi chi pool moi
     * biet request nay thuoc truong nao.
     */
    const staff =
        await authorizeStaff(
            universityIdOf(
                pool.university
            ),
            staffId,
            "FINANCE"
        );

    console.log(
        "duyet boi:",
        staff.staffId,
        "-",
        ROLE_LABEL[staff.role]
    );

    if (
        !pool
        ||
        pool.status
        !==
        "DEPLOYED"
    ) {
        throw new Error(
            "Withdrawal request is not assigned to a deployed pool"
        );
    }

    if (
        String(
            scholarship.pool
        )
        !==
        String(
            pool._id
        )
    ) {
        throw new Error(
            "Withdrawal request pool does not match scholarship pool"
        );
    }

    if (
        String(
            request.poolContractAddress
        ).toLowerCase()
        !==
        String(
            pool.contractAddress
        ).toLowerCase()
        ||
        String(
            request.poolChainId
        )
        !==
        String(
            pool.chainId
        )
    ) {
        throw new Error(
            "Withdrawal request blockchain domain does not match its pool"
        );
    }

    const universityStudent =
        scholarship
            .universityStudent;

    console.log(
        "\n========================"
    );

    console.log(
        "WITHDRAWAL REQUEST REVIEW"
    );

    console.log(
        "========================"
    );

    console.log(
        "requestId:",
        request._id.toString()
    );

    console.log(
        "studentId:",
        universityStudent.studentId
    );

    console.log(
        "email:",
        universityStudent.email
    );

    console.log(
        "Finance-approved amount:",
        universityStudent.amountWei,
        "wei"
    );

    console.log(
        "Requested amount:",
        request.amountWei,
        "wei"
    );

    console.log(
        "recipient:",
        request.recipient
    );

    /*
     * =========================
     * REJECT
     * =========================
     */
    if (
        decision
        ===
        "reject"
    ) {
        request.status =
            "REJECTED";

        request.reviewedAt =
            new Date();

        request.failureReason =
            undefined;

        scholarship.status =
            "ROOT_APPROVED";

        await request.save();
        await scholarship.save();

        console.log(
            "\n========================"
        );

        console.log(
            "WITHDRAWAL REQUEST REJECTED"
        );

        console.log(
            "========================"
        );

        console.log(
            "No blockchain transaction was sent"
        );

        return request;
    }

    /*
     * =========================
     * APPROVE AND TRANSFER
     * =========================
     */

    if (
        !request.localVerificationPassed
    ) {
        throw new Error(
            "Proof did not pass local Halo2 verification"
        );
    }

    if (!request.proof) {
        throw new Error(
            "Stored proof is missing"
        );
    }

    /*
     * Verify lại proof ngay trước khi gửi giao dịch,
     * thay vì chỉ tin cờ localVerificationPassed đã
     * lưu trong MongoDB. Nếu proof trong DB bị sửa,
     * bước này chặn trước khi tiêu tiền.
     */
    const reverification =
        verifyProofOffChain(
            request.proof,
            request.expectedRoot,
            request.expectedNullifier,
            decimalToBytes32(
                String(
                    request.amountWei
                )
            ),
            /*
             * A25 — ví nhận trong yêu cầu. Bên dưới còn kiểm nó trùng
             * ví đã đăng ký, nên hai phép cùng buộc proof vào đúng ví đó.
             */
            request.recipient
        );

    console.log(
        "re-verify before withdraw: PASSED",
        "verify_ms:",
        reverification.verifyMs
    );

    const financeAmount =
        BigInt(
            universityStudent.amountWei
        ).toString();

    const requestedAmount =
        BigInt(
            request.amountWei
        ).toString();

    if (
        requestedAmount
        !==
        financeAmount
    ) {
        throw new Error(
            "Requested amount does not match Finance-approved amount"
        );
    }

    if (
        String(
            request.recipient
        ).toLowerCase()
        !==
        String(
            scholarship.walletAddress
        ).toLowerCase()
    ) {
        throw new Error(
            "Recipient does not match the registered student wallet"
        );
    }

    const expectedRoot =
        normalizeBytes32(
            String(
                request.expectedRoot
            )
        );

    const expectedNullifier =
        normalizeBytes32(
            String(
                request.expectedNullifier
            )
        );

    await assertPoolUniversity(
        pool.contractAddress,
        pool.universityAddress,
        pool.chainId
    );

    const school =
        await resolveSender(
            pool.universityAddress,
            process.env.UNIVERSITY_PRIVATE_KEY
        );

    const contract =
        getShieldedPoolContract(
            pool.contractAddress
        );

    /*
     * Không bắt root phải bằng currentRoot.
     * Proof vẫn được dùng nếu root cũ còn
     * nằm trong validRoot history.
     */
    const rootIsValid =
        await contract.methods
            .validRoot(
                expectedRoot
            )
            .call();

    if (!rootIsValid) {
        throw new Error(
            "The proof root is not in validRoot history"
        );
    }

    /*
     * Chỉ đọc để hiển thị. Không chặn tại backend vì
     * ShieldedPool phải là lớp quyết định nullifier replay.
     */
    const nullifierUsed =
        await contract.methods
            .usedNullifier(
                expectedNullifier
            )
            .call();

    const poolBalance =
        BigInt(
            await getPoolBalance(
                pool.contractAddress
            )
        );

    request.reviewedAt =
        new Date();

    console.log(
        "\n========================"
    );

    console.log(
        "UNIVERSITY APPROVED"
    );

    console.log(
        "EXECUTING WITHDRAWAL"
    );

    console.log(
        "========================"
    );

    console.log(
        "school account:",
        school
    );

    console.log(
        "expectedRoot:",
        expectedRoot
    );

    console.log(
        "expectedNullifier:",
        expectedNullifier
    );

    console.log(
        "usedNullifier before:",
        nullifierUsed
    );

    console.log(
        "pool balance before:",
        poolBalance.toString(),
        "wei"
    );

    console.log(
        "on-chain replay attempt:",
        isReplayAttempt
    );

    /*
     * D2 — tiền kiểm số dư pool, cho khớp ONC.
     *
     * Contract vẫn có require riêng nên đây KHÔNG phải lớp
     * bảo mật; nó chỉ đổi một giao dịch revert khó đọc thành
     * một thông điệp rõ nghĩa, và tiết kiệm phí gas thất bại.
     *
     * Bỏ qua khi đang thử replay: lượt đó cố ý gửi lại để
     * contract tự chặn bằng usedNullifier, không phải để rút.
     */
    if (
        !isReplayAttempt
        &&
        BigInt(poolBalance)
        <
        BigInt(request.amountWei)
    ) {
        throw new Error(
            "Insufficient pool balance"
        );
    }

    try {
        /*
         * Với code native Halo2 hiện tại,
         * proof đã được verify off-chain
         * trước khi tạo WithdrawalRequest.
         */
        const method =
            contract.methods
                .withdrawOffChain(
                    expectedRoot,
                    expectedNullifier,
                    request.recipient,
                    requestedAmount
                );

        /*
         * Do not call estimateGas here. A gas estimation would simulate
         * the replay and reject it in Node.js before it is broadcast.
         * A fixed gas limit lets the EVM execute and revert the transaction.
         */
        const withdrawalGasLimit =
            process.env.WITHDRAW_GAS_LIMIT
            ||
            "300000";

        if (
            !/^[1-9][0-9]*$/.test(
                withdrawalGasLimit
            )
        ) {
            throw new Error(
                "WITHDRAW_GAS_LIMIT must be a positive integer"
            );
        }

        const tx =
            await method.send({
                from:
                    school,

                gas:
                    BigInt(
                        withdrawalGasLimit
                    ).toString()
            }).on(
                "transactionHash",
                (
                    hash:
                        string
                ) => {
                    console.log(
                        "submitted transactionHash:",
                        String(
                            hash
                        )
                    );
                }
            );

        request.status =
            "EXECUTED";

        request.transactionHash =
            String(
                tx.transactionHash
            );

        /*
         * Gas thực tế của withdrawOffChain.
         * Số liệu cho cột off-chain bảng gas §2.1.2.
         */
        request.withdrawGasUsed =
            BigInt(
                tx.gasUsed
            ).toString();

        request.failureReason =
            undefined;

        scholarship.status =
            "WITHDRAWN";

        scholarship.withdrawTxHash =
            String(
                tx.transactionHash
            );

        await request.save();
        await scholarship.save();

        const usedAfter =
            await contract.methods
                .usedNullifier(
                    expectedNullifier
                )
                .call();

        console.log(
            "\n========================"
        );

        console.log(
            "WITHDRAWAL EXECUTED"
        );

        console.log(
            "========================"
        );

        console.log(
            "transactionHash:",
            tx.transactionHash
        );

        console.log(
            "amount:",
            requestedAmount,
            "wei"
        );

        console.log(
            "withdraw gasUsed:",
            request.withdrawGasUsed
        );

        console.log(
            "recipient:",
            request.recipient
        );

        console.log(
            "usedNullifier after:",
            usedAfter
        );

        console.log(
            "WithdrawalRequest.status:",
            request.status
        );

        console.log(
            "StudentScholarship.status:",
            scholarship.status
        );

        return request;

    } catch (
        error:
            any
    ) {
        const failureReason =
            error?.reason
            ||
            error?.cause?.message
            ||
            error?.message
            ||
            "Unknown blockchain error";

        if (!isReplayAttempt) {
            request.status =
                "EXECUTION_FAILED";

            request.failureReason =
                failureReason;

            await request.save();
        }

        console.error(
            "\n========================"
        );

        console.error(
            "WITHDRAWAL EXECUTION FAILED"
        );

        console.error(
            "========================"
        );

        console.error(
            "Reason:",
            failureReason
        );

        throw error;
    }
}

/*
 * ===== DUYET THEO LO — XAO TRON THU TU CHI TIEN =====
 * Them 2026-09-01. Doi xung voi nhanh ONC.
 *
 * VI SAO CO HAM NAY.
 *
 * `anonymityExperiment.ts` do "kenh thu tu" (duong tan cong 4): ke quan
 * sat biet THU TU NOP DON, roi doan "lan rut thu i tren chuoi la nguoi
 * nop thu i". Kenh nay ton tai vi `onlySchool` buoc moi lenh rut di qua
 * MOT tai khoan => MOT chuoi nonce => EVM xu ly dung thu tu gui.
 *
 * 🔴 LO HONG DA PHAT HIEN 2026-09-01: bien phap chong duy nhat —
 * "truong XAO TRON truoc khi giai ngan" — CHI TON TAI TRONG FILE THI
 * NGHIEM (`scenario.shuffleWithdrawOrder`). Luong that KHONG he xao:
 * `reviewWithdrawalRequest` nhan DUNG MOT `requestId` nen khong co khai
 * niem thu tu de ma xao. Can bo bam tu tren xuong danh sach cho => thu
 * tu tren chuoi = thu tu nop don => KENH MO TOANG.
 *
 * NHUNG GI GIU NGUYEN:
 *   - Phan quyen: moi don van di qua `reviewWithdrawalRequest`, van goi
 *     `authorizeStaff(..., "FINANCE")`.
 *   - Hop dong: KHONG dung toi => gas KHONG doi.
 *   - Nha truong van quyet DUYET HAY KHONG; chi THU TU CHI la do he
 *     thong quyet.
 *
 * 🔴 PHAI dung `crypto.randomInt`, KHONG dung `Math.random`.
 * 🔴 PHAI chay TUAN TU — ca lo di chung MOT vi truong, mot chuoi nonce.
 *
 * ⚠️ Day la BIEN PHAP VAN HANH, khong phai bao dam mat ma. No dong kenh
 * thu tu voi ke quan sat CHI NHIN CHUOI; nguoi doc duoc MongoDB van thay
 * `reviewedAt` tung don.
 */
function xaoTronThuTu<T>(danhSach: T[]): T[] {
    const crypto = require("crypto");
    const ketQua = danhSach.slice();

    // Fisher-Yates, nguon ngau nhien mat ma.
    // Destructuring thay vi bien tam: `noUncheckedIndexedAccess` coi
    // `ketQua[i]` la `T | undefined`.
    for (let i = ketQua.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [ketQua[i], ketQua[j]] = [ketQua[j] as T, ketQua[i] as T];
    }

    return ketQua;
}

async function reviewWithdrawalBatch(
    requestIds: string[],
    staffId: string,
    decision: "approve" | "reject"
) {
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
        throw new Error("requestIds must be a non-empty array");
    }

    if (new Set(requestIds).size !== requestIds.length) {
        throw new Error("requestIds contains duplicates");
    }

    const thuTuChi = xaoTronThuTu(requestIds);

    console.log(
        "duyet theo lo:", requestIds.length, "don"
        + " | thu tu chi tien DA XAO TRON (crypto.randomInt)"
    );

    const ketQua: any[] = [];
    const thatBai: any[] = [];

    for (const requestId of thuTuChi) {
        try {
            const r = await reviewWithdrawalRequest(
                requestId,
                staffId,
                decision
            );

            ketQua.push(r);
        } catch (error) {
            /*
             * Mot don hong KHONG duoc chan ca lo — dung lai thi cac don
             * con lai giu nguyen thu tu nop, dung cai ta vua chong.
             */
            thatBai.push({
                id: requestId,
                error: (error as Error).message
            });
        }
    }

    return {
        total: requestIds.length,
        succeeded: ketQua.length,
        failed: thatBai.length,

        /*
         * KHONG tra ve `thuTuChi` — in ra la tu tay dua lai dung thu tu
         * ma ham nay sinh ra de giau.
         */
        results: requestIds
            .map((id) =>
                ketQua.find((r) => String(r.id) === String(id))
            )
            .filter(Boolean),

        failures: thatBai,
        shuffled: true
    };
}

module.exports = {
    reviewWithdrawalRequest,
    reviewWithdrawalBatch
};

if (require.main === module) {
    require("../cli/reviewWithdrawalRequestCli")
        .runReviewWithdrawalRequestCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
