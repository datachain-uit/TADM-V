import test from 'node:test';
import assert from 'node:assert/strict';
import { runProver } from '../clients/prover/halo2ProverClient';
import { merklePathFromArray, merklePathFromNodes } from '../utils/merklePath';

const STUDENTS = [
  { student_id: 24560000, amount: '2', rho: '11111111111111111111' },
  { student_id: 24560001, amount: '3', rho: '22222222222222222222' },
  { student_id: 24560002, amount: '5', rho: '33333333333333333333' },
  { student_id: 24560003, amount: '7', rho: '44444444444444444444' },
];

const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

test('a stored Merkle path gives the same proof as rebuilding the tree', () => {
  const commitments = STUDENTS.map((student: any) => runProver('commitment', student).commitment);

  const tree = runProver('root', { commitments });

  assert.ok(Array.isArray(tree.nodes), 'mode `root` must return `nodes`');

  assert.ok(Array.isArray(tree.zeros), 'mode `root` must return `zeros`');

  assert.equal(tree.nodes.length, tree.zeros.length, 'the level count must equal the zeros count');

  for (let i = 0; i < STUDENTS.length; i += 1) {
    const base = {
      ...STUDENTS[i],
      merkle_index: i,
      recipient: RECIPIENT,
    };

    const previous = runProver('prove', {
      ...base,
      commitments,
    });

    const filePath = merklePathFromArray(i, tree.nodes, tree.zeros);

    const current = runProver('prove', {
      ...base,
      commitments: [],
      ...filePath,
    });

    assert.equal(current.root, previous.root, `root differs at merkle_index ${i}`);

    assert.equal(current.root, tree.root, `root differs from mode \`root\` at index ${i}`);

    assert.equal(current.nullifier, previous.nullifier, `nullifier differs at merkle_index ${i}`);

    assert.equal(current.proof.length, previous.proof.length, `proof size differs at merkle_index ${i}`);
  }
});

test('an empty slot uses zeros[level], not a copy of the left node', () => {
  const nodes = [['0xaa'], ['0xbb'], ['0xcc']];

  const zeros = ['0x00', '0x01', '0x02'];

  const filePath = merklePathFromArray(0, nodes, zeros);

  assert.deepEqual(filePath.siblings, ['0x00', '0x01']);

  assert.deepEqual(filePath.directions, [false, false]);
});

test('sibling indexes and directions match get_path', () => {
  const filePath = merklePathFromNodes(
    5,
    3,
    ['0x00', '0x01', '0x02'],

    (level: number, index: number) => '0x' + String(level) + String(index),
  );

  assert.deepEqual(filePath.directions, [true, false, true]);

  assert.deepEqual(filePath.siblings, ['0x04', '0x13', '0x20']);
});
