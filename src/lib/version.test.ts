import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newerReleases } from './version.ts';

test('the next release is the newest of the same major version, and a later major one is told apart', () => {
  const tags = ['v2.9.0', 'v3.0.0', 'v3.1.0', 'v3.2.0', 'v3.10.1', 'v4.0.0', 'v4.1.0', 'not-a-release'];
  assert.deepEqual(newerReleases(tags, '3.1.0'), { next: '3.10.1', major: '4.1.0' });
  assert.deepEqual(newerReleases(tags, '3.10.1'), { next: undefined, major: '4.1.0' });
  assert.deepEqual(newerReleases(tags, '4.1.0'), { next: undefined, major: undefined });
});
