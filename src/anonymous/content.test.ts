import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentKeys, decrypt, encrypt } from './content.ts';

const keys = contentKeys('a-secret-of-at-least-thirty-two-characters');

test("a message is only readable with its conversation's key, which is only readable with the secret", () => {
  const { key, kept } = keys.newKey();
  const sealed = encrypt(key, 'Hola, equipo');
  assert.ok(!sealed.includes('Hola'));
  assert.equal(decrypt(keys.key(kept), sealed), 'Hola, equipo');

  // Another conversation's key, or the same secret's keys under another secret, read nothing.
  assert.throws(() => decrypt(keys.newKey().key, sealed));
  assert.throws(() => contentKeys('another-secret-of-at-least-thirty-two-chars').key(kept));
});

test('a shortened tag, easier to forge, is refused', () => {
  const { key } = keys.newKey();
  const data = Buffer.from(encrypt(key, 'Hola').slice(3), 'base64url');
  const short = Buffer.concat([data.subarray(0, 12), data.subarray(12, 16), data.subarray(28)]);
  assert.throws(() => decrypt(key, `v1.${short.toString('base64url')}`));
});

test('encrypting the same text twice gives different results, and tampering is noticed', () => {
  const { key } = keys.newKey();
  assert.notEqual(encrypt(key, 'Hola'), encrypt(key, 'Hola'));
  const sealed = encrypt(key, 'Hola');
  const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => decrypt(key, tampered));
});
