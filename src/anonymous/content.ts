import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * The text of anonymous conversations, encrypted, so that only placeholders reach Slack and a copy of the database
 * holds nothing readable without ANON_SECRET. Each conversation has a key of its own, kept in the database protected
 * by a key derived from that secret. Destroying a conversation's key makes its text unreadable in the database for
 * good; a backup made before still holds the key, and so the text, for whoever also has the secret.
 */
export interface ContentKeys {
  /** A new conversation's key, and the form it is kept in. */
  newKey(): { key: Buffer; kept: string };
  /** The key of a conversation, from the form it is kept in. */
  key(kept: string): Buffer;
}

/** Marks the format, so a later one can be told apart. */
const VERSION = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function seal(key: Buffer, data: Buffer, purpose: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(purpose));
  const sealed = Buffer.concat([cipher.update(data), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url');
}

function open(key: Buffer, text: string, purpose: string): Buffer {
  if (!text.startsWith(VERSION)) throw new Error('Unknown encryption format');
  const data = Buffer.from(text.slice(VERSION.length), 'base64url');
  if (data.length < IV_BYTES + TAG_BYTES) throw new Error('Encrypted text too short');
  // The tag's length is fixed, so a shortened one, easier to forge, is refused.
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export function contentKeys(secret: string): ContentKeys {
  // Its own key, apart from the one that scrambles authors' IDs, though both come from the same secret.
  const master = Buffer.from(hkdfSync('sha256', secret, 'agora', 'anon-content-keys', 32));
  return {
    newKey() {
      const key = randomBytes(32);
      return { key, kept: seal(master, key, 'conversation-key') };
    },
    key: (kept) => open(master, kept, 'conversation-key'),
  };
}

/** A message's text, encrypted with its conversation's key. */
export function encrypt(key: Buffer, text: string): string {
  return seal(key, Buffer.from(text, 'utf8'), 'message');
}

export function decrypt(key: Buffer, text: string): string {
  return open(key, text, 'message').toString('utf8');
}
