import type { DatabaseSync } from 'node:sqlite';
import { row } from './database.ts';

/** A conversation with someone outside the team channel (by DM or @mention), mirrored as one thread in it. */
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

const SELECT = `
  SELECT id, kind, user_id AS userId, target_channel AS targetChannel, target_thread_ts AS targetThreadTs,
         team_thread_ts AS teamThreadTs, team_channel AS teamChannel, created_at AS createdAt,
         last_activity_at AS lastActivityAt
  FROM conversations`;

/**
 * Conversations by DM or @mention. Only those of the current team channel are found, so pointing the bot at another
 * channel starts fresh threads there instead of replying to threads it can't see.
 */
export class Conversations {
  #db: DatabaseSync;
  #channel: string;

  constructor(db: DatabaseSync, teamChannel: string) {
    this.#db = db;
    this.#channel = teamChannel;
  }

  /** The most recent DM conversation in this DM channel that was active since `since`. */
  latestDm(dmChannel: string, since: number): Conversation | undefined {
    const found = this.#db
      .prepare(`${SELECT} WHERE kind = 'dm' AND target_channel = ? AND last_activity_at >= ? AND team_channel = ?
                ORDER BY last_activity_at DESC, id DESC LIMIT 1`)
      .get(dmChannel, since, this.#channel);
    return row<Conversation>(found);
  }

  mentionThread(channel: string, threadTs: string): Conversation | undefined {
    const found = this.#db
      .prepare(`${SELECT} WHERE kind = 'mention' AND target_channel = ? AND target_thread_ts = ?
                AND team_channel = ? ORDER BY id DESC LIMIT 1`)
      .get(channel, threadTs, this.#channel);
    return row<Conversation>(found);
  }

  byTeamThread(teamThreadTs: string): Conversation | undefined {
    const found = this.#db
      .prepare(`${SELECT} WHERE team_thread_ts = ? AND team_channel = ?`)
      .get(teamThreadTs, this.#channel);
    return row<Conversation>(found);
  }

  create(
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
}
