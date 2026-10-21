import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The SQLite database and its schema. Only Slack IDs, timestamps and keyed hashes are stored: message contents stay
// in Slack.

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

/** Opens (or creates) the database and brings its schema up to date. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Wait for another connection's write instead of failing, as when `pnpm clean-db` runs beside the bot.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Databases from before conversations recorded their team channel.
  for (const table of ['conversations', 'anon_conversations']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === 'team_channel')) db.exec(`ALTER TABLE ${table} ADD COLUMN team_channel TEXT`);
  }
  return db;
}

function tables(db: DatabaseSync): string[] {
  const found = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return found.map((table) => String(table.name));
}

/** How many rows each table holds. */
export function rowCounts(db: DatabaseSync): Map<string, number> {
  return new Map(tables(db).map((name) => [name, Number(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get()!.n)]));
}

/**
 * Deletes every row, so the bot starts over as on its first run. Deleted rows are overwritten, the file rebuilt and
 * the write-ahead log emptied, so nothing deleted can be read back from disk.
 */
export function emptyDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA secure_delete = ON; BEGIN; PRAGMA defer_foreign_keys = ON;');
  for (const name of tables(db)) db.exec(`DELETE FROM "${name}"`);
  db.exec('COMMIT; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
}

/** node:sqlite returns null-prototype objects; hand out plain ones. */
export function row<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : ({ ...(value as object) } as T);
}
