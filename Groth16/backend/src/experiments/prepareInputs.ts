import fs from 'fs';
import path from 'path';
import { MERKLE_DEPTH, MerkleTree, createCommitment, createNullifier } from '../utils/merkleTree';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const DATASET_DIR = path.resolve(PROJECT_ROOT, '../Mode B/experiments/data');

const OUT_DIR = path.resolve(PROJECT_ROOT, 'experiments/data');

const SCENARIOS = [1, 10, 30, 60, 100, 500];

async function main() {
  if (!fs.existsSync(DATASET_DIR)) {
    throw new Error(
      `Source dataset not found: ${DATASET_DIR}\n` +
        `The baseline folder must sit next to the two repositories under code/.`,
    );
  }

  fs.mkdirSync(OUT_DIR, {
    recursive: true,
  });

  const summary: any[] = [];

  for (const n of SCENARIOS) {
    const datasetPath = path.resolve(DATASET_DIR, `dataset_n${n}.json`);

    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

    if (dataset.merkle_depth !== MERKLE_DEPTH) {
      throw new Error(
        `dataset_n${n}.json records merkle_depth=${dataset.merkle_depth}, ` +
          `the circom circuit uses ${MERKLE_DEPTH}. The two must match.`,
      );
    }

    const commitmentStart = Date.now();

    const commitments: bigint[] = [];

    for (const student of dataset.students) {
      commitments.push(await createCommitment(student.note.student_id, student.note.amount, student.note.rho));
    }

    const commitmentMs = Date.now() - commitmentStart;

    const treeStart = Date.now();

    const tree = new MerkleTree(MERKLE_DEPTH);

    await tree.insertAll(commitments);

    const treeBuildMs = Date.now() - treeStart;

    const root = tree.root();

    const inputs: any[] = [];

    for (let i = 0; i < dataset.students.length; i++) {
      const student = dataset.students[i];

      const { siblings, directions } = tree.getPath(i);

      const nullifier = await createNullifier(student.note.rho);

      inputs.push({
        student_index: student.student_index,
        address: student.address,

        input: {
          student_id: String(student.note.student_id),
          rho: String(student.note.rho),
          siblings: siblings.map((x: bigint) => x.toString()),
          directions: directions.map((x: number) => String(x)),
          root: root.toString(),
          nullifier: nullifier.toString(),
          amount: String(student.note.amount),

          recipient: BigInt(student.address).toString(),
        },
      });
    }

    const outPath = path.resolve(OUT_DIR, `inputs_n${n}.json`);

    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          n,
          merkle_depth: MERKLE_DEPTH,
          proof_system: 'groth16 (circom/snarkjs)',
          hash: 'circomlib Poseidon - values do NOT match the halo2_base sponge',
          nguon_dataset: `Mode B/experiments/data/dataset_n${n}.json`,
          root: root.toString(),

          thoiGian: {
            commitment_ms: commitmentMs,
            tree_build_ms: treeBuildMs,
            ghiChu:
              'The tree is built ONCE per scenario and shared by all' +
              ' n students - the K10 convention, same as the two main' +
              ' branches (they store the tree in merkleNodes when the root' +
              ' is approved, and each withdrawal reads only d nodes). The' +
              ' witness_ms of all three branches does NOT include this step.',
          },

          inputs,
        },
        null,
        2,
      ),
    );

    summary.push({
      n,
      studentCount: inputs.length,
      root: root.toString(),
      file: path.relative(PROJECT_ROOT, outPath),
    });
  }

  console.log(
    JSON.stringify(
      {
        step: 'prepareInputs',
        merkle_depth: MERKLE_DEPTH,
        scenarios: summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error: any) => {
  console.error(error);
  process.exit(1);
});
