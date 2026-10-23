import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The SQLite database and its schema. It stores Slack IDs, timestamps and keyed hashes, and the text of anonymous
// conversations, encrypted (see anonymous/content.ts). Every other message's text stays in Slack.

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
    deleted_at INTEGER,
    file_ids TEXT
  );

  CREATE TABLE IF NOT EXISTS relays (
    dm_channel TEXT NOT NULL,
    dm_ts TEXT NOT NULL,
    team_channel TEXT NOT NULL,
    team_ts TEXT NOT NULL,
    notice_ts TEXT,
    problems_ts TEXT,
    file_ids TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (dm_channel, dm_ts)
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
    closed_by TEXT CHECK (closed_by IN ('person', 'team', 'expired')),
    encrypted INTEGER NOT NULL DEFAULT 0,
    content_key TEXT
  );
  CREATE INDEX IF NOT EXISTS anon_conversations_owner ON anon_conversations (owner);

  CREATE TABLE IF NOT EXISTS anon_messages (
    team_message_ts TEXT PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES anon_conversations (id),
    author TEXT NOT NULL CHECK (author IN ('person', 'team')),
    sent_by TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    content TEXT,
    edited_at INTEGER,
    edited_by TEXT,
    deleted_by TEXT
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
  // Wait for another connection's write instead of failing, as when `pnpm clean-db` runs beside the bot. What is deleted
  // or replaced is overwritten with zeros, so a forgotten author's hash can't be read back from the file.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;');
  db.exec(SCHEMA);
  // Databases from before conversations recorded their team channel, before deliveries recorded their files, before
  // relays recorded the notice about files that couldn't be copied, and before anonymous messages were encrypted.
  const addColumn = (table: string, column: string, type = 'TEXT') => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('conversations', 'team_channel');
  addColumn('anon_conversations', 'team_channel');
  addColumn('deliveries', 'file_ids');
  addColumn('relays', 'problems_ts');
  addColumn('anon_conversations', 'encrypted', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('anon_conversations', 'content_key');
  addColumn('anon_messages', 'content');
  addColumn('anon_messages', 'edited_at', 'INTEGER');
  addColumn('anon_messages', 'edited_by');
  addColumn('anon_messages', 'deleted_by');
  // Rewritten with only what it holds now, on every start: what earlier versions deleted without overwriting it, or a
  // crash left behind, is gone from the file. The database is small, so this takes moments.
  db.exec('VACUUM');
  emptyLog(db);
  return db;
}

/**
 * Copies the write-ahead log into the database file and empties it. The log keeps earlier versions of what changed
 * until then, so this follows forgetting an author, for their hash not to stay in it.
 */
export function emptyLog(db: DatabaseSync): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
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
  db.exec('COMMIT; VACUUM;');
  emptyLog(db);
}

/** node:sqlite returns null-prototype objects; hand out plain ones. */
export function row<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : ({ ...(value as object) } as T);
}
