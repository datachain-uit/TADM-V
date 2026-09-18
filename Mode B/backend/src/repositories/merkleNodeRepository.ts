/*
 * K10 — 03/09/2026
 *
 * Doc/ghi cac nut cay Merkle da luu san, de buoc rut khong
 * phai dung lai ca cay.
 *
 * TRUOC:  moi luot rut doc TOAN BO commitment roi chen lai
 *         tung la  ->  n x depth phep bam MOI LUOT.
 * SAU:    duyet root luu cay mot lan; moi luot rut doc dung
 *         `depth` nut  ->  0 phep bam.
 *
 * `layDuongMerkle` phai giong HET `MerkleTree::get_path`
 * trong circuits/src/merkle_tree.rs:173. Quy uoc:
 *   is_right       = index % 2 == 1
 *   sibling_index  = is_right ? index - 1 : index + 1
 *   o trong        -> zeros[level]  (KHONG phai ban sao nut trai)
 *   index          = index / 2 sau moi tang
 * Lech mot chi tiet la ra root khac va proof hong.
 */

const {
    MerkleNode
} = require(
    "../models/MerkleNode"
);

const {
    normalizeBytes32
} = require(
    "../services/generateStudentFile"
);

const {
    duongMerkleTuNut
} = require(
    "../utils/merklePath"
);

/*
 * Ghi de toan bo cay cua mot pool.
 *
 * Dung `bulkWrite` + `upsert` de duyet root lan hai ghi de
 * chinh xac nhung o da doi, khong tao ban sao va khong phai
 * xoa truoc — xoa truoc se de lai khoang thoi gian cay rong,
 * luc do mot luot rut chay song song se khong tim thay duong.
 */
async function luuCayMerkle(
    poolId:
        any,

    nodes:
        string[][]
): Promise<number> {

    const thaoTac:
        any[] = [];

    nodes.forEach(
        (
            tang:
                string[],

            level:
                number
        ) => {
            tang.forEach(
                (
                    hash:
                        string,

                    index:
                        number
                ) => {
                    thaoTac.push(
                        {
                            updateOne: {
                                filter: {
                                    pool:
                                        poolId,

                                    level:
                                        level,

                                    index:
                                        index
                                },

                                update: {
                                    $set: {
                                        hash:
                                            normalizeBytes32(
                                                String(
                                                    hash
                                                )
                                            )
                                    }
                                },

                                upsert:
                                    true
                            }
                        }
                    );
                }
            );
        }
    );

    if (thaoTac.length === 0) {
        return 0;
    }

    await MerkleNode.bulkWrite(
        thaoTac,

        {
            ordered:
                false
        }
    );

    return thaoTac.length;
}

/*
 * Lay duong Merkle cua mot la.
 *
 * Tra ve `null` khi cay chua duoc luu — goi y la pool duoc
 * duyet root truoc ban K10. Nguoi goi PHAI quay ve duong cu
 * (gui toan bo commitment) thay vi bao loi, de du lieu cu
 * van rut duoc.
 */
async function layDuongMerkle(
    poolId:
        any,

    merkleIndex:
        number,

    depth:
        number,

    zeros:
        string[]
): Promise<
    {
        siblings: string[];
        directions: boolean[];
    }
    | null
> {

    if (
        !Array.isArray(zeros)
        ||
        zeros.length < depth
    ) {
        return null;
    }

    /*
     * Doc mot lan tat ca nut co the la sibling, thay vi
     * `depth` lan truy van roi rac.
     */
    const canLay:
        {
            level: number;
            index: number;
        }[] = [];

    let viTri =
        merkleIndex;

    for (
        let level = 0;
        level < depth;
        level += 1
    ) {
        const laConPhai =
            viTri % 2 === 1;

        canLay.push(
            {
                level:
                    level,

                index:
                    laConPhai
                        ? viTri - 1
                        : viTri + 1
            }
        );

        viTri =
            Math.floor(
                viTri / 2
            );
    }

    const banGhi =
        await MerkleNode.find(
            {
                pool:
                    poolId,

                $or:
                    canLay
            }
        ).lean();

    if (banGhi.length === 0) {
        return null;
    }

    const tra =
        new Map<
            string,
            string
        >();

    banGhi.forEach(
        (
            row:
                any
        ) => {
            tra.set(
                String(row.level)
                + ":"
                + String(row.index),

                String(row.hash)
            );
        }
    );

    const ketQua =
        duongMerkleTuNut(
            merkleIndex,

            depth,

            zeros,

            (
                level:
                    number,

                index:
                    number
            ) =>
                tra.get(
                    String(level)
                    + ":"
                    + String(index)
                )
        );

    const siblings =
        ketQua.siblings.map(
            (
                value:
                    string
            ) =>
                normalizeBytes32(
                    String(value)
                )
        );

    const directions =
        ketQua.directions;

    return {
        siblings,
        directions
    };
}

module.exports = {
    luuCayMerkle,
    layDuongMerkle
};
