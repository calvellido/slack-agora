import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Only Slack IDs, timestamps and keyed hashes are stored here. Message contents stay in Slack.
//
// Conversations remember the team channel their thread is in. Only those of the current TEAM_CHANNEL_ID are found,
// so pointing the bot at another channel starts fresh threads there instead of replying to threads it can't see.

/** A conversation with someone outside the team channel, mirrored as one thread in the team channel. */
export interface Conversation {
  id: number;
  kind: 'dm' | 'mention';
  /** The person the bot is talking to (DM) or who mentioned the bot. */
  userId: string;
  /** Where replies sent as the bot go: the DM channel, or the channel of the mention. */
  targetChannel: string;
  /** Thread in targetChannel for mentions; null for DMs. */
  targetThreadTs: string | null;
  /** Parent message of the conversation thread in the team channel. */
  teamThreadTs: string;
  /** The team channel that thread is in; null for rows from before channels were recorded. */
  teamChannel: string | null;
  createdAt: number;
  lastActivityAt: number;
}

/** Something the bot sent on the team's behalf, keyed by its record message in the team channel. */
export interface Delivery {
  teamMessageTs: string;
  targetChannel: string;
  /** Null while the send is in flight. */
  targetTs: string | null;
  sentBy: string;
  sentAt: number;
  deletedAt: number | null;
}

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
  /** Keyed hash of the author's Slack ID (see anonymity.ts); null once purged. */
  owner: string | null;
  createdAt: number;
  lastActivityAt: number;
  /** Last time the author's Home tab showed this conversation. */
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

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('dm', 'mention')),
    user_id TEXT NOT NULL,
    target_channel TEXT NOT NULL,
    target_thread_ts TEXT,
    team_thread_ts TEXT NOT NULL UNIQUE,
    team_channel TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS conversations_target ON conversations (target_channel, target_thread_ts);

  CREATE TABLE IF NOT EXISTS deliveries (
    team_message_ts TEXT PRIMARY KEY,
    target_channel TEXT NOT NULL,
    target_ts TEXT,
    sent_by TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS anon_conversations (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    team_thread_ts TEXT UNIQUE,
    team_channel TEXT,
    owner TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    closed_at INTEGER,
    closed_by TEXT CHECK (closed_by IN ('person', 'team', 'expired'))
  );
  CREATE INDEX IF NOT EXISTS anon_conversations_owner ON anon_conversations (owner);

  CREATE TABLE IF NOT EXISTS anon_messages (
    team_message_ts TEXT PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES anon_conversations (id),
    author TEXT NOT NULL CHECK (author IN ('person', 'team')),
    sent_by TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS anon_messages_conversation ON anon_messages (conversation_id);

  -- Blocking was removed; drop what an earlier version may have stored.
  DROP TABLE IF EXISTS anon_blocks;

  -- Settings of the running bot itself, such as its last heartbeat.
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const CONVERSATION = `
  SELECT id, kind, user_id AS userId, target_channel AS targetChannel, target_thread_ts AS targetThreadTs,
         team_thread_ts AS teamThreadTs, team_channel AS teamChannel, created_at AS createdAt,
         last_activity_at AS lastActivityAt
  FROM conversations`;

const DELIVERY = `
  SELECT team_message_ts AS teamMessageTs, target_channel AS targetChannel, target_ts AS targetTs,
         sent_by AS sentBy, sent_at AS sentAt, deleted_at AS deletedAt
  FROM deliveries`;

const ANON = `
  SELECT id, code AS handle, team_thread_ts AS teamThreadTs, team_channel AS teamChannel, owner, created_at AS createdAt,
         last_activity_at AS lastActivityAt, seen_at AS seenAt, closed_at AS closedAt, closed_by AS closedBy
  FROM anon_conversations`;

const ANON_MESSAGE = `
  SELECT team_message_ts AS teamMessageTs, conversation_id AS conversationId, author, sent_by AS sentBy,
         created_at AS createdAt, deleted_at AS deletedAt
  FROM anon_messages`;

/** node:sqlite returns null-prototype objects; hand out plain ones. */
function row<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : ({ ...(value as object) } as T);
}

export class Store {
  #db: DatabaseSync;
  #channel: string;

  /** `teamChannel` is the current TEAM_CHANNEL_ID. */
  constructor(path: string, teamChannel: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#channel = teamChannel;
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec(SCHEMA);
    for (const table of ['conversations', 'anon_conversations']) {
      const columns = this.#db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some((c) => c.name === 'team_channel')) {
        this.#db.exec(`ALTER TABLE ${table} ADD COLUMN team_channel TEXT`);
      }
    }
  }

  /** The most recent DM conversation in this DM channel that was active since `since`. */
  latestDm(dmChannel: string, since: number): Conversation | undefined {
    const found = this.#db
      .prepare(`${CONVERSATION} WHERE kind = 'dm' AND target_channel = ? AND last_activity_at >= ? AND team_channel = ?
                ORDER BY last_activity_at DESC, id DESC LIMIT 1`)
      .get(dmChannel, since, this.#channel);
    return row<Conversation>(found);
  }

  mentionThread(channel: string, threadTs: string): Conversation | undefined {
    const found = this.#db
      .prepare(`${CONVERSATION} WHERE kind = 'mention' AND target_channel = ? AND target_thread_ts = ?
                AND team_channel = ? ORDER BY id DESC LIMIT 1`)
      .get(channel, threadTs, this.#channel);
    return row<Conversation>(found);
  }

  byTeamThread(teamThreadTs: string): Conversation | undefined {
    const found = this.#db
      .prepare(`${CONVERSATION} WHERE team_thread_ts = ? AND team_channel = ?`)
      .get(teamThreadTs, this.#channel);
    return row<Conversation>(found);
  }

  createConversation(
    c: Pick<Conversation, 'kind' | 'userId' | 'targetChannel' | 'targetThreadTs' | 'teamThreadTs'>,
    now = Date.now(),
  ): Conversation {
    const { lastInsertRowid } = this.#db
      .prepare(`INSERT INTO conversations (kind, user_id, target_channel, target_thread_ts, team_thread_ts,
                                           team_channel, created_at, last_activity_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(c.kind, c.userId, c.targetChannel, c.targetThreadTs, c.teamThreadTs, this.#channel, now, now);
    return { ...c, id: Number(lastInsertRowid), teamChannel: this.#channel, createdAt: now, lastActivityAt: now };
  }

  touch(conversationId: number, now = Date.now()): void {
    this.#db.prepare('UPDATE conversations SET last_activity_at = ? WHERE id = ?').run(now, conversationId);
  }

  /** Reserves a team message for sending. False if it was already sent (or is being sent). */
  claimDelivery(teamMessageTs: string, targetChannel: string, sentBy: string, now = Date.now()): boolean {
    const { changes } = this.#db
      .prepare(`INSERT OR IGNORE INTO deliveries (team_message_ts, target_channel, sent_by, sent_at)
                VALUES (?, ?, ?, ?)`)
      .run(teamMessageTs, targetChannel, sentBy, now);
    return changes === 1;
  }

  completeDelivery(teamMessageTs: string, targetTs: string): void {
    this.#db.prepare('UPDATE deliveries SET target_ts = ? WHERE team_message_ts = ?').run(targetTs, teamMessageTs);
  }

  releaseDelivery(teamMessageTs: string): void {
    this.#db.prepare('DELETE FROM deliveries WHERE team_message_ts = ? AND target_ts IS NULL').run(teamMessageTs);
  }

  recordDelivery(teamMessageTs: string, targetChannel: string, targetTs: string, sentBy: string, now = Date.now()) {
    this.#db
      .prepare(`INSERT INTO deliveries (team_message_ts, target_channel, target_ts, sent_by, sent_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(teamMessageTs, targetChannel, targetTs, sentBy, now);
  }

  delivery(teamMessageTs: string): Delivery | undefined {
    return row<Delivery>(this.#db.prepare(`${DELIVERY} WHERE team_message_ts = ?`).get(teamMessageTs));
  }

  markDeleted(teamMessageTs: string, now = Date.now()): void {
    this.#db.prepare('UPDATE deliveries SET deleted_at = ? WHERE team_message_ts = ?').run(now, teamMessageTs);
  }

  // Anonymous conversations

  /** Creates a conversation with an unused handle; its thread in the team channel is set once posted. */
  reserveAnon(owner: string, makeHandle: () => string, now = Date.now()): AnonConversation {
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

  setAnonThread(id: number, teamThreadTs: string): void {
    this.#db.prepare('UPDATE anon_conversations SET team_thread_ts = ? WHERE id = ?').run(teamThreadTs, id);
  }

  /** Removes a reservation whose the team channel thread could not be posted. */
  dropAnon(id: number): void {
    this.#db.prepare('DELETE FROM anon_conversations WHERE id = ? AND team_thread_ts IS NULL').run(id);
  }

  anonById(id: number): AnonConversation | undefined {
    return row<AnonConversation>(this.#db.prepare(`${ANON} WHERE id = ?`).get(id));
  }

  anonByHandle(handle: string): AnonConversation | undefined {
    const found = this.#db.prepare(`${ANON} WHERE code = ? AND team_channel = ?`).get(handle, this.#channel);
    return row<AnonConversation>(found);
  }

  anonByTeamThread(teamThreadTs: string): AnonConversation | undefined {
    const found = this.#db
      .prepare(`${ANON} WHERE team_thread_ts = ? AND team_channel = ?`)
      .get(teamThreadTs, this.#channel);
    return row<AnonConversation>(found);
  }

  /** The author's conversations that aren't purged yet, most recently active first. */
  anonForOwner(owner: string, limit: number): AnonConversation[] {
    return this.#db
      .prepare(`${ANON} WHERE owner = ? AND team_thread_ts IS NOT NULL AND team_channel = ?
                ORDER BY last_activity_at DESC, id DESC LIMIT ?`)
      .all(owner, this.#channel, limit)
      .map((r) => row<AnonConversation>(r)!);
  }

  openAnonCount(owner: string): number {
    const { count } = this.#db
      .prepare(`SELECT count(*) AS count FROM anon_conversations
                WHERE owner = ? AND closed_at IS NULL AND team_thread_ts IS NOT NULL AND team_channel = ?`)
      .get(owner, this.#channel) as { count: number };
    return count;
  }

  touchAnon(id: number, now = Date.now()): void {
    this.#db.prepare('UPDATE anon_conversations SET last_activity_at = ? WHERE id = ?').run(now, id);
  }

  markAnonSeen(id: number, now = Date.now()): void {
    this.#db.prepare('UPDATE anon_conversations SET seen_at = ? WHERE id = ?').run(now, id);
  }

  /** False if it was already closed. */
  closeAnon(id: number, by: ClosedBy, now = Date.now()): boolean {
    const { changes } = this.#db
      .prepare('UPDATE anon_conversations SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL')
      .run(now, by, id);
    return changes === 1;
  }

  /** Forgets who wrote a conversation, and which of its messages in the team channel were theirs. */
  purgeAnon(id: number): void {
    this.#db.prepare('UPDATE anon_conversations SET owner = NULL WHERE id = ?').run(id);
    this.#db.prepare('DELETE FROM anon_messages WHERE conversation_id = ?').run(id);
  }

  /** Closes open conversations inactive since `before`, in any team channel, and returns them. */
  expireAnon(before: number, now = Date.now()): AnonConversation[] {
    const stale = this.#db
      .prepare(`${ANON} WHERE closed_at IS NULL AND team_thread_ts IS NOT NULL AND last_activity_at < ?`)
      .all(before)
      .map((r) => row<AnonConversation>(r)!);
    return stale.filter((c) => this.closeAnon(c.id, 'expired', now));
  }

  /** Purges conversations closed before `before`, in any team channel, and returns them; drops reservations left by
   * a crash before then. */
  purgeClosedAnon(before: number): AnonConversation[] {
    const closed = this.#db
      .prepare(`${ANON} WHERE closed_at < ? AND owner IS NOT NULL`)
      .all(before)
      .map((r) => row<AnonConversation>(r)!);
    for (const { id } of closed) this.purgeAnon(id);
    this.#db.prepare('DELETE FROM anon_conversations WHERE team_thread_ts IS NULL AND created_at < ?').run(before);
    return closed.map((c) => ({ ...c, owner: null }));
  }

  /** Removes every record of a conversation, once its messages are deleted from the team channel. */
  deleteAnon(id: number): void {
    this.#db.prepare('DELETE FROM anon_messages WHERE conversation_id = ?').run(id);
    this.#db.prepare('DELETE FROM anon_conversations WHERE id = ?').run(id);
  }

  /** False if this the team channel message was already recorded (a reply already sent). */
  addAnonMessage(
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

  anonMessage(teamMessageTs: string): AnonMessage | undefined {
    return row<AnonMessage>(this.#db.prepare(`${ANON_MESSAGE} WHERE team_message_ts = ?`).get(teamMessageTs));
  }

  /** Messages not deleted, oldest first. */
  anonMessages(conversationId: number): AnonMessage[] {
    return this.#db
      .prepare(`${ANON_MESSAGE} WHERE conversation_id = ? AND deleted_at IS NULL
                ORDER BY created_at, team_message_ts`)
      .all(conversationId)
      .map((r) => row<AnonMessage>(r)!);
  }

  /** False if it was already deleted. */
  markAnonMessageDeleted(teamMessageTs: string, now = Date.now()): boolean {
    const { changes } = this.#db
      .prepare('UPDATE anon_messages SET deleted_at = ? WHERE team_message_ts = ? AND deleted_at IS NULL')
      .run(now, teamMessageTs);
    return changes === 1;
  }

  /** When the bot last said it was running (ms), or undefined if it never did. */
  lastAlive(): number | undefined {
    const found = this.#db.prepare("SELECT value FROM meta WHERE key = 'last_alive'").get() as { value: string } | undefined;
    return found ? Number(found.value) : undefined;
  }

  setLastAlive(now = Date.now()): void {
    this.#db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_alive', ?)").run(String(now));
  }

  close(): void {
    this.#db.close();
  }
}
