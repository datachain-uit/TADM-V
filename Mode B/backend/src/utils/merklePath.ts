/*
 * K10 — 03/09/2026
 *
 * Suy duong Merkle tu CAC NUT da co san, khong bam lai gi.
 *
 * Day la ban port cua `MerkleTree::get_path`
 * (circuits/src/merkle_tree.rs:173). Phai giong HET, vi lech
 * mot chi tiet la ra root khac va proof hong:
 *
 *   is_right      = index % 2 == 1
 *   sibling_index = is_right ? index - 1 : index + 1
 *   o TRONG       -> zeros[level]
 *                    (KHONG nhan doi nut trai — CVE-2012-2459)
 *   index         = floor(index / 2) sau moi tang
 *
 * Ham nay THUAN: khong doc MongoDB, khong doc file. Nguoi goi
 * truyen vao `timNut` de quyet dinh nut den tu dau — repository
 * lay tu MongoDB, runner thuc nghiem lay tu mang trong bo nho.
 * Nho vay chi co MOT cai dat cua quy uoc tren.
 */

type TimNut = (
    level: number,
    index: number
) => string | undefined;

function duongMerkleTuNut(
    merkleIndex:
        number,

    depth:
        number,

    zeros:
        string[],

    timNut:
        TimNut
): {
    siblings: string[];
    directions: boolean[];
} {

    if (
        !Number.isInteger(merkleIndex)
        ||
        merkleIndex < 0
    ) {
        throw new Error(
            "merkleIndex must be a non-negative integer"
        );
    }

    if (
        !Number.isInteger(depth)
        ||
        depth <= 0
    ) {
        throw new Error(
            "depth must be a positive integer"
        );
    }

    if (
        !Array.isArray(zeros)
        ||
        zeros.length < depth
    ) {
        throw new Error(
            "zeros must have at least `depth` entries"
        );
    }

    const siblings:
        string[] = [];

    const directions:
        boolean[] = [];

    let viTri =
        merkleIndex;

    for (
        let level = 0;
        level < depth;
        level += 1
    ) {
        const laConPhai =
            viTri % 2 === 1;

        const chiSoAnhEm =
            laConPhai
                ? viTri - 1
                : viTri + 1;

        const daCo =
            timNut(
                level,
                chiSoAnhEm
            );

        siblings.push(
            String(
                daCo !== undefined
                    ? daCo
                    : zeros[level]
            )
        );

        directions.push(
            laConPhai
        );

        viTri =
            Math.floor(
                viTri / 2
            );
    }

    return {
        siblings,
        directions
    };
}

/*
 * Tien ich cho nguoi goi da co san toan bo cay trong bo nho
 * (runner thuc nghiem): `nodes[level][index]`.
 */
function duongMerkleTuMang(
    merkleIndex:
        number,

    nodes:
        string[][],

    zeros:
        string[]
): {
    siblings: string[];
    directions: boolean[];
} {

    return duongMerkleTuNut(
        merkleIndex,

        nodes.length - 1,

        zeros,

        (
            level:
                number,

            index:
                number
        ) => {
            const tang =
                nodes[level];

            if (!tang) {
                return undefined;
            }

            return index < tang.length
                ? tang[index]
                : undefined;
        }
    );
}

module.exports = {
    duongMerkleTuNut,
    duongMerkleTuMang
};
