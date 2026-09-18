const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

const WithdrawalRequestSchema =
    new Schema(
        {
            pool: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    "ScholarshipPool",

                required:
                    true
            },

            poolContractAddress: {
                type:
                    String,

                required:
                    true,

                lowercase:
                    true,

                match:
                    /^0x[0-9a-f]{40}$/
            },

            poolChainId: {
                type:
                    String,

                required:
                    true,

                match:
                    /^[0-9]+$/
            },

            scholarship: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    "StudentScholarship",

                required:
                    true
            },

            /*
             * Proof không chứa private witnesses.
             * Nó được lưu để University có thể
             * approve và thực hiện giao dịch sau.
             */
            proof: {
                type:
                    String,

                required:
                    true
            },

            /*
             * Một số EVM proving backend trả thêm
             * calldata. Field này là optional.
             */
            calldata: {
                type:
                    String
            },

            /*
             * Đây là public input gắn với proof.
             * Không phải nguồn Merkle root chính thức.
             * Khi execute, backend vẫn kiểm tra
             * validRoot(expectedRoot) trên contract.
             */
            expectedRoot: {
                type:
                    String,

                required:
                    true,

                lowercase:
                    true,

                match:
                    /^0x[0-9a-f]{64}$/
            },

            expectedNullifier: {
                type:
                    String,

                required:
                    true,

                lowercase:
                    true,

                match:
                    /^0x[0-9a-f]{64}$/
            },

            amountWei: {
                type:
                    String,

                required:
                    true,

                match:
                    /^[1-9][0-9]*$/
            },

            recipient: {
                type:
                    String,

                required:
                    true,

                match:
                    /^0x[0-9a-fA-F]{40}$/
            },

            /*
             * Cho biết proof đã qua bước
             * verification cục bộ của backend.
             *
             * Với on-chain mode, verifier contract
             * vẫn verify lại khi University approve.
             */
            localVerificationPassed: {
                type:
                    Boolean,

                required:
                    true,

                default:
                    false
            },

            /*
             * Thời gian verify off-chain, đo bằng
             * mode verify riêng của prover.
             * Số liệu cho bảng §2.1.1.
             *
             * verificationMs: chỉ lời gọi verify_proof.
             * verificationSetupMs: nạp params + dựng vk.
             */
            verificationMs: {
                type:
                    Number,

                min:
                    0
            },

            verificationSetupMs: {
                type:
                    Number,

                min:
                    0
            },

            status: {
                type:
                    String,

                enum: [
                    "PENDING_APPROVAL",
                    "REJECTED",
                    "EXECUTED",

                    // Transaction thất bại nhưng
                    // request vẫn có thể được thử lại.
                    "EXECUTION_FAILED"
                ],

                required:
                    true,

                default:
                    "PENDING_APPROVAL"
            },

            proofPreparedAt: {
                type:
                    Date,

                required:
                    true
            },

            reviewedAt: {
                type:
                    Date
            },

            transactionHash: {
                type:
                    String
            },

            /*
             * Gas thực tế của withdrawOffChain.
             * Số liệu đo đạc cho bảng gas §2.1.2
             * (cột off-chain), không tham gia
             * vào logic nghiệp vụ nào.
             */
            withdrawGasUsed: {
                type:
                    String,

                match:
                    /^[0-9]+$/
            },

            failureReason: {
                type:
                    String
            }
        },

        {
            timestamps:
                true,

            versionKey:
                false
        }
    );

WithdrawalRequestSchema.index({
    pool:
        1,

    scholarship:
        1,

    status:
        1
});

const WithdrawalRequest =
    mongoose.models.WithdrawalRequest
    ||
    mongoose.model(
        "WithdrawalRequest",
        WithdrawalRequestSchema
    );

module.exports = {
    WithdrawalRequest
};
