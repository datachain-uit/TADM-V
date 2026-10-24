/// <reference path="../types/circomlibjs.d.ts" />
import { buildPoseidon } from 'circomlibjs';

const MERKLE_DEPTH = 9;

let poseidonInstance: any = null;

async function getPoseidon() {
  if (poseidonInstance === null) {
    poseidonInstance = await buildPoseidon();
  }

  return poseidonInstance;
}

async function poseidonHash(inputs: (string | bigint)[]): Promise<bigint> {
  const poseidon = await getPoseidon();

  const out = poseidon(inputs.map((x) => BigInt(x)));

  return BigInt(poseidon.F.toString(out));
}

class MerkleTree {
  depth: number;
  nodes: bigint[][];
  zeros: bigint[];

  constructor(depth: number) {
    this.depth = depth;

    this.nodes = [];

    for (let i = 0; i <= depth; i++) {
      this.nodes.push([]);
    }

    this.zeros = [];
  }

  async buildZeros() {
    const z: bigint[] = [BigInt(0)];

    for (let level = 0; level < this.depth; level++) {
      const previous = z[level];

      if (previous === undefined) {
        throw new Error(`Zeros table broken at level ${level}`);
      }

      z.push(await poseidonHash([previous, previous]));
    }

    this.zeros = z;
  }

  zeroAt(level: number): bigint {
    const z = this.zeros[level];

    if (z === undefined) {
      throw new Error(`Zeros table not built - call buildZeros() first.` + ` Missing level ${level}.`);
    }

    return z;
  }

  async insertAll(leaves: bigint[]) {
    await this.buildZeros();

    this.nodes[0] = leaves.slice();

    await this.buildTree();
  }

  async buildTree() {
    for (let level = 0; level < this.depth; level++) {
      const current = this.nodes[level];

      if (current === undefined) {
        throw new Error(`Broken tree: missing level ${level}`);
      }

      const next: bigint[] = [];

      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];

        if (left === undefined) {
          throw new Error(`Broken tree: level ${level} is missing node ${i}`);
        }

        const right = i + 1 < current.length ? current[i + 1] : this.zeroAt(level);

        if (right === undefined) {
          throw new Error(`Broken tree: level ${level} is missing node ${i + 1}`);
        }

        next.push(await poseidonHash([left, right]));
      }

      this.nodes[level + 1] = next;
    }
  }

  root(): bigint {
    const topLevel = this.nodes[this.depth];

    if (topLevel === undefined || topLevel[0] === undefined) {
      throw new Error(`Tree not built or empty - call insertAll() before reading the root.`);
    }

    return topLevel[0];
  }

  getPath(index: number): {
    siblings: bigint[];
    directions: number[];
  } {
    const siblings: bigint[] = [];
    const directions: number[] = [];

    let idx = index;

    for (let level = 0; level < this.depth; level++) {
      const levelNodes = this.nodes[level];

      if (levelNodes === undefined) {
        throw new Error(`Broken tree: missing level ${level}`);
      }

      const isRight = idx % 2 === 1;

      const siblingIndex = isRight ? idx - 1 : idx + 1;

      const sibling = siblingIndex < levelNodes.length ? levelNodes[siblingIndex] : this.zeroAt(level);

      if (sibling === undefined) {
        throw new Error(`Broken tree: level ${level}, cannot get the sibling for index ${idx}`);
      }

      siblings.push(sibling);

      directions.push(isRight ? 1 : 0);

      idx = Math.floor(idx / 2);
    }

    return {
      siblings,
      directions,
    };
  }
}

async function createCommitment(
  studentId: string | bigint,
  amount: string | bigint,
  rho: string | bigint,
): Promise<bigint> {
  return poseidonHash([studentId, amount, rho]);
}

async function createNullifier(rho: string | bigint): Promise<bigint> {
  return poseidonHash([rho]);
}

export { MERKLE_DEPTH, MerkleTree, poseidonHash, createCommitment, createNullifier };
