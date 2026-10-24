import test from 'node:test';
import assert from 'node:assert/strict';
import { retryChainRead } from '../utils/chainRead';

test('retryChainRead returns the first successful read', async () => {
  let calls = 0;

  const value = await retryChainRead(
    async () => {
      calls++;

      if (calls < 3) {
        throw new Error('header not found');
      }
      return 'ready';
    },
    5,
    1,
  );

  assert.equal(value, 'ready');
  assert.equal(calls, 3);
});

test('retryChainRead gives up after the last attempt', async () => {
  let calls = 0;

  await assert.rejects(
    retryChainRead(
      async () => {
        calls++;
        throw new Error('header not found');
      },
      3,
      1,
    ),
    /after 3 attempts: header not found/,
  );
  assert.equal(calls, 3);
});
