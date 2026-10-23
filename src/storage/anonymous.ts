import type { DatabaseSync } from 'node:sqlite';
import { emptyLog, row } from './database.ts';

export type ClosedBy = 'person' | 'team' | 'expired';

/** An anonymous conversation. Nothing here identifies the author once `owner` is cleared. */
export interface AnonConversation {
  id: number;
  /**
   * Random, private identifier the author's window uses to refer to the conversation. Never shown, and never put in
   * the team channel, so nothing visible links the author's window to the thread.
   */
  handle: string;
  /** Parent message in the team channel; null while it is being posted. */
  teamThreadTs: string | null;
  /** The team channel that thread is in; null for rows from before channels were recorded. */
  teamChannel: string | null;
  /** Keyed hash of the author's Slack ID (see anonymous/keys.ts); null once purged. */
  owner: string | null;
  createdAt: number;
  lastActivityAt: number;
  /** Last time the author opened this conversation. */
  seenAt: number;
  closedAt: number | null;
  closedBy: ClosedBy | null;
}

/** A message of an anonymous conversation, posted in its thread in the team channel. */
export interface AnonMessage {
  teamMessageTs: string;
  conversationId: number;
  author: 'person' | 'team';
  /** Team member who sent a team reply. */
  sentBy: string | null;
  createdAt: number;
  deletedAt: number | null;
}

// The `code` column holds the handle; it kept its name from when it was shown as a code.
const SELECT = `
  SELECT id, code AS handle, team_thread_ts AS teamThreadTs, team_channel AS teamChannel, owner, created_at AS createdAt,
         last_activity_at AS lastActivityAt, seen_at AS seenAt, closed_at AS closedAt, closed_by AS closedBy
  FROM anon_conversations`;

const SELECT_MESSAGE = `
  SELECT team_message_ts AS teamMessageTs, conversation_id AS conversationId, author, sent_by AS sentBy,
         created_at AS createdAt, deleted_at AS deletedAt
  FROM anon_messages`;

/**
 * Anonymous conversations and which of their messages in the team channel came from whom. Lookups only find those of
 * the current team channel; expiring and purging cover every channel, so no author link outlives its schedule.
 */
export class AnonymousConversations {
  #db: DatabaseSync;
  #channel: string;

  constructor(db: DatabaseSync, teamChannel: string) {
    this.#db = db;
    this.#channel = teamChannel;
  }

  /** Creates a conversation with an unused handle; its thread in the team channel is set once posted. */
  reserve(owner: string, makeHandle: () => string, now = Date.now()): AnonConversation {
    const insert = this.#db.prepare(`INSERT OR IGNORE INTO anon_conversations
                                     (code, team_channel, owner, created_at, last_activity_at, seen_at)
                                     VALUES (?, ?, ?, ?, ?, ?)`);
    for (let attempt = 0; attempt < 50; attempt++) {
      const handle = makeHandle();
      const { changes, lastInsertRowid } = insert.run(handle, this.#channel, owner, now, now, now);
      if (changes === 1) {
        return {
          id: Number(lastInsertRowid),
          handle,
          teamThreadTs: null,
          teamChannel: this.#channel,
          owner,
          createdAt: now,
          lastActivityAt: now,
          seenAt: now,
          closedAt: null,
          closedBy: null,
        };
      }
    }
    throw new Error('No unused anonymous handle found');
  }

  setThread(id: number, teamThreadTs: string): void {
    this.#db.prepare('UPDATE anon_conversations SET team_thread_ts = ? WHERE id = ?').run(teamThreadTs, id);
  }

  /** Removes a reservation whose thread in the team channel could not be posted. */
  drop(id: number): void {
    this.#db.prepare('DELETE FROM anon_conversations WHERE id = ? AND team_thread_ts IS NULL').run(id);
    emptyLog(this.#db);
  }

  byId(id: number): AnonConversation | undefined {
    return row<AnonConversation>(this.#db.prepare(`${SELECT} WHERE id = ?`).get(id));
  }

  byHandle(handle: string): AnonConversation | undefined {
    const found = this.#db.prepare(`${SELECT} WHERE code = ? AND team_channel = ?`).get(handle, this.#channel);
    return row<AnonConversation>(found);
  }

  byTeamThread(teamThreadTs: string): AnonConversation | undefined {
    const found = this.#db
      .prepare(`${SELECT} WHERE team_thread_ts = ? AND team_channel = ?`)
      .get(teamThreadTs, this.#channel);
    return row<AnonConversation>(found);
  }

  /** The author's conversations that aren't purged yet, most recently active first. */
  forOwner(owner: string, limit: number): AnonConversation[] {
    return this.#db
      .prepare(`${SELECT} WHERE owner = ? AND team_thread_ts IS NOT NULL AND team_channel = ?
                ORDER BY last_activity_at DESC, id DESC LIMIT ?`)
      .all(owner, this.#channel, limit)
      .map((r) => row<AnonConversation>(r)!);
  }

  openCount(owner: string): number {
    const { count } = this.#db
      .prepare(`SELECT count(*) AS count FROM anon_conversations
                WHERE owner = ? AND closed_at IS NULL AND team_thread_ts IS NOT NULL AND team_channel = ?`)
      .get(owner, this.#channel) as { count: number };
    return count;
  }

  touch(id: number, now = Date.now()): void {
    this.#db.prepare('UPDATE anon_conversations SET last_activity_at = ? WHERE id = ?').run(now, id);
  }

  markSeen(id: number, now = Date.now()): void {
    this.#db.prepare('UPDATE anon_conversations SET seen_at = ? WHERE id = ?').run(now, id);
  }

  /** Ends a conversation. False if it had already ended. */
  close(id: number, by: ClosedBy, now = Date.now()): boolean {
    const { changes } = this.#db
      .prepare('UPDATE anon_conversations SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL')
      .run(now, by, id);
    return changes === 1;
  }

  /** Forgets who wrote a conversation, and which of its messages in the team channel were theirs. */
  purge(id: number): void {
    this.#forget(id);
    emptyLog(this.#db);
  }

  #forget(id: number): void {
    this.#db.prepare('UPDATE anon_conversations SET owner = NULL WHERE id = ?').run(id);
    this.#db.prepare('DELETE FROM anon_messages WHERE conversation_id = ?').run(id);
  }

  /** Ends open conversations inactive since `before`, in any team channel, and returns them. */
  expire(before: number, now = Date.now()): AnonConversation[] {
    const stale = this.#db
      .prepare(`${SELECT} WHERE closed_at IS NULL AND team_thread_ts IS NOT NULL AND last_activity_at < ?`)
      .all(before)
      .map((r) => row<AnonConversation>(r)!);
    return stale.filter((c) => this.close(c.id, 'expired', now));
  }

  /**
   * Purges conversations ended before `before`, in any team channel, and returns them; drops reservations left by a
   * crash before then.
   */
  purgeClosed(before: number): AnonConversation[] {
    const closed = this.#db
      .prepare(`${SELECT} WHERE closed_at < ? AND owner IS NOT NULL`)
      .all(before)
      .map((r) => row<AnonConversation>(r)!);
    for (const { id } of closed) this.#forget(id);
    this.#db.prepare('DELETE FROM anon_conversations WHERE team_thread_ts IS NULL AND created_at < ?').run(before);
    emptyLog(this.#db);
    return closed.map((c) => ({ ...c, owner: null }));
  }

  /** Removes every record of a conversation, once its messages are deleted from the team channel. */
  remove(id: number): void {
    this.#db.prepare('DELETE FROM anon_messages WHERE conversation_id = ?').run(id);
    this.#db.prepare('DELETE FROM anon_conversations WHERE id = ?').run(id);
    emptyLog(this.#db);
  }

  /** False if this team channel message was already recorded (a reply already sent). */
  addMessage(
    teamMessageTs: string,
    conversationId: number,
    author: AnonMessage['author'],
    sentBy: string | null,
    now = Date.now(),
  ): boolean {
    const { changes } = this.#db
      .prepare(`INSERT OR IGNORE INTO anon_messages (team_message_ts, conversation_id, author, sent_by, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(teamMessageTs, conversationId, author, sentBy, now);
    return changes === 1;
  }

  message(teamMessageTs: string): AnonMessage | undefined {
    return row<AnonMessage>(this.#db.prepare(`${SELECT_MESSAGE} WHERE team_message_ts = ?`).get(teamMessageTs));
  }

  /** Messages not deleted, oldest first. */
  messages(conversationId: number): AnonMessage[] {
    return this.#db
      .prepare(`${SELECT_MESSAGE} WHERE conversation_id = ? AND deleted_at IS NULL
                ORDER BY created_at, team_message_ts`)
      .all(conversationId)
      .map((r) => row<AnonMessage>(r)!);
  }

  /** False if it was already deleted. */
  markMessageDeleted(teamMessageTs: string, now = Date.now()): boolean {
    const { changes } = this.#db
      .prepare('UPDATE anon_messages SET deleted_at = ? WHERE team_message_ts = ? AND deleted_at IS NULL')
      .run(now, teamMessageTs);
    return changes === 1;
  }
}
