/*
 * K10 — 03/09/2026
 *
 * Luu CAC NUT cua cay Merkle theo tung pool, de buoc rut
 * chi phai DOC `depth` nut thay vi dung lai ca cay tu toan
 * bo commitment.
 *
 * VI SAO LUU O CAP POOL, KHONG LUU THEO SINH VIEN:
 *   - Khong co truong nao ten `siblings` hay `directions`,
 *     nen khong dung vao rang buoc C6.
 *   - Nut cay la Poseidon cua cac commitment VON DA nam
 *     trong MongoDB, nen khong lo them thong tin gi.
 *   - Them mot sinh vien chi doi `depth` nut tren duong tu
 *     la len goc. Neu luu duong theo tung sinh vien thi moi
 *     lan them phai cap nhat duong cua rat nhieu nguoi khac.
 *
 * `level` 0 la tang la; `level` = depth la goc (chi co
 * index 0). `zeros[level]` — goc cay con RONG cua tang do —
 * luu rieng trong ScholarshipPool vi no dung cho ca cay.
 */

const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

const MerkleNodeSchema =
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

            level: {
                type:
                    Number,

                required:
                    true,

                min:
                    0
            },

            index: {
                type:
                    Number,

                required:
                    true,

                min:
                    0
            },

            hash: {
                type:
                    String,

                required:
                    true,

                trim:
                    true,

                match:
                    /^0x[0-9a-fA-F]{64}$/
            }
        },

        {
            timestamps:
                true
        }
    );

/*
 * Mot o trong cay la duy nhat theo (pool, level, index).
 * Duyet root lai lan hai thi GHI DE, khong tao ban sao.
 */
MerkleNodeSchema.index(
    {
        pool: 1,
        level: 1,
        index: 1
    },

    {
        unique:
            true
    }
);

const MerkleNode =
    mongoose.models.MerkleNode
    ||
    mongoose.model(
        "MerkleNode",
        MerkleNodeSchema
    );

module.exports = {
    MerkleNode
};
