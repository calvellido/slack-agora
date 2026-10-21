import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration } from './time.ts';

test('durations read the same in English and Spanish', () => {
  assert.equal(formatDuration(20_000), '1 min');
  assert.equal(formatDuration(7 * 60_000), '7 min');
  assert.equal(formatDuration(2 * 3_600_000 + 14 * 60_000), '2 h 14 min');
  assert.equal(formatDuration(3 * 3_600_000), '3 h');
  assert.equal(formatDuration(4 * 86_400_000 + 3_600_000), '4 d 1 h');
});
