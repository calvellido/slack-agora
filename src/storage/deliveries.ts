import type { DatabaseSync } from 'node:sqlite';
import { row } from './database.ts';

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

const SELECT = `
  SELECT team_message_ts AS teamMessageTs, target_channel AS targetChannel, target_ts AS targetTs,
         sent_by AS sentBy, sent_at AS sentAt, deleted_at AS deletedAt
  FROM deliveries`;

/** What the bot sent as replies or posts, so it can be deleted later from its record in the team channel. */
export class Deliveries {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Reserves a team message for sending. False if it was already sent (or is being sent). */
  claim(teamMessageTs: string, targetChannel: string, sentBy: string, now = Date.now()): boolean {
    const { changes } = this.#db
      .prepare(`INSERT OR IGNORE INTO deliveries (team_message_ts, target_channel, sent_by, sent_at)
                VALUES (?, ?, ?, ?)`)
      .run(teamMessageTs, targetChannel, sentBy, now);
    return changes === 1;
  }

  complete(teamMessageTs: string, targetTs: string): void {
    this.#db.prepare('UPDATE deliveries SET target_ts = ? WHERE team_message_ts = ?').run(targetTs, teamMessageTs);
  }

  /** Gives up a claim whose send failed, so it can be tried again. */
  release(teamMessageTs: string): void {
    this.#db.prepare('DELETE FROM deliveries WHERE team_message_ts = ? AND target_ts IS NULL').run(teamMessageTs);
  }

  record(teamMessageTs: string, targetChannel: string, targetTs: string, sentBy: string, now = Date.now()): void {
    this.#db
      .prepare(`INSERT INTO deliveries (team_message_ts, target_channel, target_ts, sent_by, sent_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(teamMessageTs, targetChannel, targetTs, sentBy, now);
  }

  get(teamMessageTs: string): Delivery | undefined {
    return row<Delivery>(this.#db.prepare(`${SELECT} WHERE team_message_ts = ?`).get(teamMessageTs));
  }

  markDeleted(teamMessageTs: string, now = Date.now()): void {
    this.#db.prepare('UPDATE deliveries SET deleted_at = ? WHERE team_message_ts = ?').run(now, teamMessageTs);
  }
}
