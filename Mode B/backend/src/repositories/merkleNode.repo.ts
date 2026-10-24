import { MerkleNode } from '../models/merkleNode.model';
import { normalizeBytes32 } from '../utils/bytes32';
import { merklePathFromNodes } from '../utils/merklePath';

async function saveMerkleTree(
  poolId: any,

  nodes: string[][],
): Promise<number> {
  const operations: any[] = [];

  nodes.forEach(
    (
      treeLevel: string[],

      level: number,
    ) => {
      treeLevel.forEach(
        (
          hash: string,

          index: number,
        ) => {
          operations.push({
            updateOne: {
              filter: {
                pool: poolId,

                level: level,

                index: index,
              },

              update: {
                $set: {
                  hash: normalizeBytes32(String(hash)),
                },
              },

              upsert: true,
            },
          });
        },
      );
    },
  );

  if (operations.length === 0) {
    return 0;
  }

  await MerkleNode.bulkWrite(
    operations,

    {
      ordered: false,
    },
  );

  return operations.length;
}

async function getMerklePath(
  poolId: any,

  merkleIndex: number,

  depth: number,

  zeros: string[],
): Promise<{
  siblings: string[];
  directions: boolean[];
} | null> {
  if (!Array.isArray(zeros) || zeros.length < depth) {
    return null;
  }

  const toFetch: {
    level: number;
    index: number;
  }[] = [];

  let position = merkleIndex;

  for (let level = 0; level < depth; level += 1) {
    const isRightChild = position % 2 === 1;

    toFetch.push({
      level: level,

      index: isRightChild ? position - 1 : position + 1,
    });

    position = Math.floor(position / 2);
  }

  const records = await MerkleNode.find({
    pool: poolId,

    $or: toFetch,
  }).lean();

  if (records.length === 0) {
    return null;
  }

  const lookup = new Map<string, string>();

  records.forEach((row: any) => {
    lookup.set(
      String(row.level) + ':' + String(row.index),

      String(row.hash),
    );
  });

  const result = merklePathFromNodes(
    merkleIndex,

    depth,

    zeros,

    (
      level: number,

      index: number,
    ) => lookup.get(String(level) + ':' + String(index)),
  );

  const siblings = result.siblings.map((value: string) => normalizeBytes32(String(value)));

  const directions = result.directions;

  return {
    siblings,
    directions,
  };
}

export { saveMerkleTree, getMerklePath };
