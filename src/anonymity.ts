import { createHmac, randomInt } from 'node:crypto';

/**
 * Anonymous conversations are linked to their author by a keyed hash of the author's Slack ID, never the ID itself.
 * Recomputing the hash for every member of the workspace reveals the author, so ANON_SECRET must never be stored with
 * the database or its backups.
 */
export function ownerHasher(secret: string): (userId: string) => string {
  return (userId) => createHmac('sha256', secret).update(`anon-owner:${userId}`).digest('base64url');
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A random private handle for a conversation (see AnonConversation.handle). */
export function newHandle(): string {
  return Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
