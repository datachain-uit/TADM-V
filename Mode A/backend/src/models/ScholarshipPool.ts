const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

const ScholarshipPoolSchema =
    new Schema(
        {
            /*
             * MOT TRUONG CO NHIEU POOL — moi pool la MOT CHUONG TRINH
             * hoc bong (sua 2026-08-29, xem COWORK_SYNC.md S-36).
             *
             * Truoc day o day co `unique: true`, tuc mot truong chi
             * duoc MOT pool vinh vien. Sai voi bai toan that: mot
             * truong chay hoc bong khuyen khich hoc tap MOI HOC KY,
             * cong hoc bong tai tro doanh nghiep, cong hoc bong kho
             * khan. Ca hai baseline cung mo hinh nhieu chuong trinh
             * mot truong.
             *
             * Bo `unique` o day, thay bang index ghep
             * {university, programName} o cuoi file — van chan tao
             * trung MOT chuong trinh, nhung cho phep nhieu chuong
             * trinh khac ten.
             */
            university: {
                type: Schema.Types.ObjectId,
                ref: "University",
                required: true
            },

            /*
             * Ten chuong trinh hoc bong. CAN CO vi neu khong thi hai
             * pool cua cung mot truong khong phan biet duoc.
             *
             * Co `default` de document pool CU (tao truoc 29/08, khong
             * co truong nay) va cac lenh CLI cu khong bi vo.
             */
            programName: {
                type: String,
                required: true,
                trim: true,
                default: "Hoc bong khuyen khich hoc tap"
            },

            universityAddress: {
                type: String,
                required: true,
                trim: true,
                lowercase: true,
                match: /^0x[0-9a-f]{40}$/
            },

            contractAddress: {
                type: String,
                trim: true,
                lowercase: true,
                match: /^0x[0-9a-f]{40}$/
            },

            chainId: {
                type: String,
                match: /^[0-9]+$/
            },

            deploymentTransactionHash: {
                type: String,
                lowercase: true,
                match: /^0x[0-9a-f]{64}$/
            },

            /*
             * V1(b) — menh gia co dinh cua pool, don vi wei.
             *
             * "0" = KHONG cuong che (mac dinh, giu tuong thich nguoc).
             * Khac "0" thi hop dong tu chan moi luot rut co so tien khac
             * => tap an danh = kich thuoc pool tro thanh BAT BIEN, khong
             * con phu thuoc backend cau hinh dung hay sai.
             */
            denominationWei: {
                type: String,
                required: true,
                default: "0",
                match: /^[0-9]+$/
            },

            initialFundingWei: {
                type: String,
                required: true,
                default: "0",
                match: /^[0-9]+$/
            },

            /*
             * Số liệu đo đạc cho bảng gas §2.1.2
             * (cột off-chain). Không tham gia
             * vào logic nghiệp vụ nào.
             */
            deploymentGasUsed: {
                type: String,
                match: /^[0-9]+$/
            },

            lastRootUpdateGasUsed: {
                type: String,
                match: /^[0-9]+$/
            },

            /*
             * K10 — goc cay con RONG cua tung tang, do prover
             * tra ve cung luc voi root. Can de suy ra sibling
             * cua mot o TRONG, dung quy uoc trong `get_path`.
             * Dai dung depth + 1 phan tu. Xem models/MerkleNode.
             */
            merkleZeros: {
                type: [String],
                default: undefined
            },

            merkleDepth: {
                type: Number,
                min: 1
            },

            status: {
                type: String,
                enum: [
                    "PENDING_DEPLOYMENT",
                    "DEPLOYING",
                    "DEPLOYED",
                    "DEPLOYMENT_FAILED"
                ],
                required: true,
                default: "PENDING_DEPLOYMENT"
            },

            deploymentError: {
                type: String
            },

            deployedAt: {
                type: Date
            }
        },
        {
            timestamps: true,
            versionKey: false
        }
    );

/*
 * Mot truong khong duoc co HAI pool CUNG TEN chuong trinh.
 * Day la thu thay cho `unique: true` cu tren `university`.
 *
 * 🔴 BAY: bo `unique` trong schema KHONG xoa index da nam trong
 * MongoDB. Database nao da chay ban cu thi index `university_1` van
 * con va VAN CHAN. `resetDatabase` dung `deleteMany({})` — xoa
 * document, GIU index. Phai xoa tay mot lan:
 *
 *     db.scholarshippools.dropIndex("university_1")
 *
 * Xem COWORK_SYNC.md S-36.
 */
ScholarshipPoolSchema.index(
    {
        university: 1,
        programName: 1
    },
    {
        unique: true
    }
);

ScholarshipPoolSchema.index(
    {
        contractAddress: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            contractAddress: {
                $type: "string"
            }
        }
    }
);

const ScholarshipPool =
    mongoose.models.ScholarshipPool
    ||
    mongoose.model(
        "ScholarshipPool",
        ScholarshipPoolSchema
    );

module.exports = {
    ScholarshipPool
};
