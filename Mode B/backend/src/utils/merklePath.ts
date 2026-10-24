type FindNode = (level: number, index: number) => string | undefined;

function merklePathFromNodes(
  merkleIndex: number,

  depth: number,

  zeros: string[],

  findNode: FindNode,
): {
  siblings: string[];
  directions: boolean[];
} {
  if (!Number.isInteger(merkleIndex) || merkleIndex < 0) {
    throw new Error('merkleIndex must be a non-negative integer');
  }

  if (!Number.isInteger(depth) || depth <= 0) {
    throw new Error('depth must be a positive integer');
  }

  if (!Array.isArray(zeros) || zeros.length < depth) {
    throw new Error('zeros must have at least `depth` entries');
  }

  const siblings: string[] = [];

  const directions: boolean[] = [];

  let position = merkleIndex;

  for (let level = 0; level < depth; level += 1) {
    const isRightChild = position % 2 === 1;

    const siblingIndex = isRightChild ? position - 1 : position + 1;

    const seen = findNode(level, siblingIndex);

    siblings.push(String(seen !== undefined ? seen : zeros[level]));

    directions.push(isRightChild);

    position = Math.floor(position / 2);
  }

  return {
    siblings,
    directions,
  };
}

function merklePathFromArray(
  merkleIndex: number,

  nodes: string[][],

  zeros: string[],
): {
  siblings: string[];
  directions: boolean[];
} {
  return merklePathFromNodes(
    merkleIndex,

    nodes.length - 1,

    zeros,

    (
      level: number,

      index: number,
    ) => {
      const treeLevel = nodes[level];

      if (!treeLevel) {
        return undefined;
      }

      return index < treeLevel.length ? treeLevel[index] : undefined;
    },
  );
}

export { merklePathFromNodes, merklePathFromArray };
