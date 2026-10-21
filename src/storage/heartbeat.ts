import type { DatabaseSync } from 'node:sqlite';

/** When the bot last said it was running, so after a restart it knows how long it was away. */
export class Heartbeat {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** The last heartbeat (ms), or undefined if the bot never ran with this database. */
  last(): number | undefined {
    const found = this.#db.prepare("SELECT value FROM meta WHERE key = 'last_alive'").get() as { value: string } | undefined;
    return found ? Number(found.value) : undefined;
  }

  beat(now = Date.now()): void {
    this.#db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_alive', ?)").run(String(now));
  }
}
