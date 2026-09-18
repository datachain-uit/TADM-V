const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

const StudentScholarshipSchema =
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

            universityStudent: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    "UniversityStudent",

                required:
                    true,

            },

            walletAddress: {
                type:
                    String,

                required:
                    true,

                trim:
                    true,

                match:
                    /^0x[0-9a-fA-F]{40}$/
            },

            publicKey: {
                type:
                    String,

                required:
                    true,

                trim:
                    true
            },

            encryptedNoteCid: {
                type:
                    String,

                trim:
                    true
            },

            commitment: {
                type:
                    String,

                lowercase:
                    true,

                match:
                    /^0x[0-9a-f]{64}$/
            },

            merkleIndex: {
                type:
                    Number,

                min:
                    0
            },

            status: {
                type:
                    String,

                enum: [
                    "WALLET_REGISTERED",
                    "NOTE_CREATED",
                    "ROOT_APPROVED",
                    // Sinh viên đã tạo request,
                    // đang chờ University xem xét.
                    "WITHDRAWAL_REQUESTED",

                    // University đã approve,
                    // nhưng chưa chuyển tiền.
                    // "WITHDRAWAL_APPROVED",
                    "WITHDRAWN"
                ],

                required:
                    true,

                default:
                    "WALLET_REGISTERED"
            },

            withdrawTxHash: {
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

StudentScholarshipSchema.index(
    {
        pool:
            1,

        universityStudent:
            1
    },
    {
        unique:
            true
    }
);

/*
 * A21 — MOT VI CHI DUOC DUNG CHO DUNG MOT SUAT HOC BONG, VINH VIEN.
 *
 * VI SAO. `A19` cho mot truong nhieu pool = nhieu chuong trinh. Neu mot
 * sinh viem dung LAI mot vi o hai chuong trinh thi quan sat vien thay
 * `0xAAA` xuat hien o ca hai `event Withdraw`, GIAO hai tap ung vien lai
 * => tap an danh co lai. Do la kenh "gop nhieu pool" cua `FPR_UNL.1`.
 *
 * VI SAO CHAN VINH VIEN, KHONG CHI CHAN POOL DANG HOAT DONG. Su kien
 * tren chuoi la VINH CUU. Vi `0xAAA` da xuat hien o pool A thi du pool A
 * dong lai, dung lai `0xAAA` o pool B van tao lien ket — trang thai cua
 * pool A khong lam su kien cu bien mat.
 *
 * Index cu `{pool, walletAddress}` chi chan TRUNG TRONG MOT POOL. Index
 * duoi day chan TOAN CUC.
 *
 * 🔴 BAY: index nay chi dung duoc tren database chua co vi trung. DB da
 * chay ban cu ma co vi dung lai o hai pool thi Mongo TU CHOI tao index.
 * Luc do phai don du lieu truoc, hoac reset DB thi nghiem.
 */
StudentScholarshipSchema.index(
    {
        walletAddress: 1
    },
    {
        unique: true
    }
);

// Giu lai index cu: bi bao ham boi index toan cuc o tren, nhung khong
// hai, va bo di thi phai them mot buoc drop index nua.
StudentScholarshipSchema.index(
    {
        pool:
            1,

        walletAddress:
            1
    },
    {
        unique:
            true
    }
);

StudentScholarshipSchema.index(
    {
        encryptedNoteCid:
            1
    },
    {
        unique:
            true,

        partialFilterExpression: {
            encryptedNoteCid: {
                $type:
                    "string"
            }
        }
    }
);

StudentScholarshipSchema.index(
    {
        commitment:
            1
    },
    {
        unique:
            true,

        partialFilterExpression: {
            commitment: {
                $type:
                    "string"
            }
        }
    }
);

StudentScholarshipSchema.index(
    {
        pool:
            1,

        merkleIndex:
            1
    },
    {
        unique:
            true,

        partialFilterExpression: {
            merkleIndex: {
                $type:
                    "number"
            }
        }
    }
);

const StudentScholarship =
    mongoose.models.StudentScholarship
    ||
    mongoose.model(
        "StudentScholarship",
        StudentScholarshipSchema
    );

module.exports = {
    StudentScholarship
};
