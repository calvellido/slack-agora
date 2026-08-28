import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Only Slack IDs and timestamps are stored here. Message contents stay in Slack.

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

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('dm', 'mention')),
    user_id TEXT NOT NULL,
    target_channel TEXT NOT NULL,
    target_thread_ts TEXT,
    team_thread_ts TEXT NOT NULL UNIQUE,
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

`;

const CONVERSATION = `
  SELECT id, kind, user_id AS userId, target_channel AS targetChannel, target_thread_ts AS targetThreadTs,
         team_thread_ts AS teamThreadTs, created_at AS createdAt, last_activity_at AS lastActivityAt
  FROM conversations`;

const DELIVERY = `
  SELECT team_message_ts AS teamMessageTs, target_channel AS targetChannel, target_ts AS targetTs,
         sent_by AS sentBy, sent_at AS sentAt, deleted_at AS deletedAt
  FROM deliveries`;

/** node:sqlite returns null-prototype objects; hand out plain ones. */
function row<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : ({ ...(value as object) } as T);
}

export class Store {
  #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec(SCHEMA);
  }

  /** The most recent DM conversation in this DM channel that was active since `since`. */
  latestDm(dmChannel: string, since: number): Conversation | undefined {
    const found = this.#db
      .prepare(`${CONVERSATION} WHERE kind = 'dm' AND target_channel = ? AND last_activity_at >= ?
                ORDER BY last_activity_at DESC, id DESC LIMIT 1`)
      .get(dmChannel, since);
    return row<Conversation>(found);
  }

  mentionThread(channel: string, threadTs: string): Conversation | undefined {
    const found = this.#db
      .prepare(`${CONVERSATION} WHERE kind = 'mention' AND target_channel = ? AND target_thread_ts = ?
                ORDER BY id DESC LIMIT 1`)
      .get(channel, threadTs);
    return row<Conversation>(found);
  }

  byTeamThread(teamThreadTs: string): Conversation | undefined {
    return row<Conversation>(this.#db.prepare(`${CONVERSATION} WHERE team_thread_ts = ?`).get(teamThreadTs));
  }

  createConversation(
    c: Pick<Conversation, 'kind' | 'userId' | 'targetChannel' | 'targetThreadTs' | 'teamThreadTs'>,
    now = Date.now(),
  ): Conversation {
    const { lastInsertRowid } = this.#db
      .prepare(`INSERT INTO conversations
                (kind, user_id, target_channel, target_thread_ts, team_thread_ts, created_at, last_activity_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.kind, c.userId, c.targetChannel, c.targetThreadTs, c.teamThreadTs, now, now);
    return { ...c, id: Number(lastInsertRowid), createdAt: now, lastActivityAt: now };
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

  close(): void {
    this.#db.close();
  }
}
