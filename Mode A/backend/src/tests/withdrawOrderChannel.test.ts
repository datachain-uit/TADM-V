import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, prngFromSeed } from '../experiments/anonymityExperiment';

function sequence(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function unchangedPositions(root: number[], after: number[]): number {
  return root.filter((x, i) => after[i] === x).length;
}

test('order channel — the shuffle does NOT return the identity permutation', () => {
  const n = 500;
  const root = sequence(n);
  const after = shuffle(root, 12345);

  assert.notDeepEqual(after, root, 'the shuffle must change the order, otherwise the order channel is not closed');
});

test('order channel — most positions change, not just a few', () => {
  const n = 500;
  const root = sequence(n);
  const after = shuffle(root, 987654321);
  const unchanged = unchangedPositions(root, after);

  assert.ok(
    unchanged <= 10,
    'unchanged positions = ' +
      unchanged +
      '/500, too many.' +
      ' A correct random permutation has an expected value of about 1',
  );
});

test('order channel — REPRODUCIBLE: the same seed gives the same result', () => {
  const root = sequence(200);

  assert.deepEqual(shuffle(root, 42), shuffle(root, 42), 'the same seed must give the same permutation');
});

test('order channel — a different seed gives a different permutation', () => {
  const root = sequence(200);

  assert.notDeepEqual(
    shuffle(root, 42),
    shuffle(root, 43),
    'different seeds giving the same permutation means the seed has no effect',
  );
});

test('order channel — the shuffle does NOT lose or duplicate any element', () => {
  const n = 500;
  const root = sequence(n);
  const after = shuffle(root, 2026);

  assert.equal(after.length, n, 'the element count must be preserved');

  assert.deepEqual(
    [...after].sort((a, b) => a - b),
    root,
    'sorting back must give exactly the original set - nothing lost, nothing duplicated',
  );
});

test('order channel — the PRNG returns numbers in [0, 1)', () => {
  const rand = prngFromSeed(7);

  for (let i = 0; i < 1000; i += 1) {
    const x = rand();

    assert.ok(x >= 0 && x < 1, 'PRNG returned ' + x + ', outside [0, 1)');
  }
});
