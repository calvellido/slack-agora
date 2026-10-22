import type { DatabaseSync } from 'node:sqlite';
import { row } from './database.ts';

/** A DM to the bot, and what relaying it posted in the team channel, so the copy can follow its edits and deletion. */
export interface RelayedDm {
  dmChannel: string;
  dmTs: string;
  teamChannel: string;
  /** The copy of its text, with the header above it. */
  teamTs: string;
  /** The notice that shows its images, if it had any. */
  noticeTs: string | null;
  /** The notice naming its files that couldn't be copied, if any. */
  problemsTs: string | null;
  /** The copies of its files. */
  fileIds: string[];
  createdAt: number;
}

const SELECT = `
  SELECT dm_channel AS dmChannel, dm_ts AS dmTs, team_channel AS teamChannel, team_ts AS teamTs,
         notice_ts AS noticeTs, problems_ts AS problemsTs, file_ids AS fileIds, created_at AS createdAt
  FROM relays`;

export class Relays {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  record(relayed: Omit<RelayedDm, 'createdAt'>, now = Date.now()): void {
    this.#db
      .prepare(`INSERT OR REPLACE INTO relays (dm_channel, dm_ts, team_channel, team_ts, notice_ts, problems_ts, file_ids,
                                               created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        relayed.dmChannel,
        relayed.dmTs,
        relayed.teamChannel,
        relayed.teamTs,
        relayed.noticeTs,
        relayed.problemsTs,
        JSON.stringify(relayed.fileIds),
        now,
      );
  }

  get(dmChannel: string, dmTs: string): RelayedDm | undefined {
    const found = row<Omit<RelayedDm, 'fileIds'> & { fileIds: string }>(
      this.#db.prepare(`${SELECT} WHERE dm_channel = ? AND dm_ts = ?`).get(dmChannel, dmTs),
    );
    return found && { ...found, fileIds: JSON.parse(found.fileIds) as string[] };
  }

  remove(dmChannel: string, dmTs: string): void {
    this.#db.prepare('DELETE FROM relays WHERE dm_channel = ? AND dm_ts = ?').run(dmChannel, dmTs);
  }
}
