import type { DatabaseSync } from 'node:sqlite';
import { row } from './database.ts';

/** Something the bot sent on the team's behalf, keyed by its record message in the team channel. */
export interface Delivery {
  teamMessageTs: string;
  targetChannel: string;
  /** The message sent. Null while the send is in flight, or when only files were sent. */
  targetTs: string | null;
  /** The copies of files sent with it. */
  fileIds: string[];
  sentBy: string;
  sentAt: number;
  deletedAt: number | null;
}

const SELECT = `
  SELECT team_message_ts AS teamMessageTs, target_channel AS targetChannel, target_ts AS targetTs,
         file_ids AS fileIds, sent_by AS sentBy, sent_at AS sentAt, deleted_at AS deletedAt
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

  complete(teamMessageTs: string, targetTs: string | null, fileIds: readonly string[] = []): void {
    this.#db
      .prepare('UPDATE deliveries SET target_ts = ?, file_ids = ? WHERE team_message_ts = ?')
      .run(targetTs, JSON.stringify(fileIds), teamMessageTs);
  }

  /** Gives up a claim whose send failed, so it can be tried again. */
  release(teamMessageTs: string): void {
    this.#db
      .prepare('DELETE FROM deliveries WHERE team_message_ts = ? AND target_ts IS NULL AND file_ids IS NULL')
      .run(teamMessageTs);
  }

  record(
    teamMessageTs: string,
    targetChannel: string,
    targetTs: string | null,
    sentBy: string,
    fileIds: readonly string[] = [],
    now = Date.now(),
  ): void {
    this.#db
      .prepare(`INSERT INTO deliveries (team_message_ts, target_channel, target_ts, file_ids, sent_by, sent_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(teamMessageTs, targetChannel, targetTs, JSON.stringify(fileIds), sentBy, now);
  }

  get(teamMessageTs: string): Delivery | undefined {
    const found = row<Omit<Delivery, 'fileIds'> & { fileIds: string | null }>(
      this.#db.prepare(`${SELECT} WHERE team_message_ts = ?`).get(teamMessageTs),
    );
    return found && { ...found, fileIds: found.fileIds ? (JSON.parse(found.fileIds) as string[]) : [] };
  }

  markDeleted(teamMessageTs: string, now = Date.now()): void {
    this.#db.prepare('UPDATE deliveries SET deleted_at = ? WHERE team_message_ts = ?').run(now, teamMessageTs);
  }
}
