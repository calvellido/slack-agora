import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newHandle, ownerHasher } from './keys.ts';

const secret = 'x'.repeat(44);

test('the owner hash is stable, depends on the secret, and does not contain the user ID', () => {
  const hash = ownerHasher(secret);
  assert.equal(hash('U123'), hash('U123'));
  assert.notEqual(hash('U123'), hash('U124'));
  assert.notEqual(ownerHasher('y'.repeat(44))('U123'), hash('U123'));
  assert.ok(!hash('U123').includes('U123'));
});

test('handles are random and long enough not to collide', () => {
  const seen = new Set(Array.from({ length: 1000 }, () => newHandle()));
  assert.equal(seen.size, 1000);
  for (const handle of seen) assert.match(handle, /^[2-9A-HJ-NP-Z]{16}$/);
});
