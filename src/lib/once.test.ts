import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onceFor } from './once.ts';

test('a key is first only once until its time has passed', async () => {
  const first = onceFor(10);
  assert.deepEqual([first('a'), first('a'), first('b')], [true, false, true]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(first('a'), true);
});
