import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AnonymousConversations } from './anonymous.ts';
import { emptyDatabase, openDatabase, rowCounts } from './database.ts';
import { Deliveries } from './deliveries.ts';
import { Heartbeat } from './heartbeat.ts';
import { Relays } from './relays.ts';

test('emptying the database deletes every row, leaves nothing of them in its files, and keeps it usable', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agora-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'test.db');
  const db = openDatabase(path);
  const anonymous = new AnonymousConversations(db, 'C1');
  const conversation = anonymous.reserve('owner-hash-to-forget', () => 'HANDLE-TO-FORGET');
  anonymous.setThread(conversation.id, '1.0');
  new Heartbeat(db).beat();

  emptyDatabase(db);
  assert.deepEqual([...rowCounts(db).values()].filter((count) => count > 0), []);
  for (const file of [path, `${path}-wal`]) {
    assert.doesNotMatch(readFileSync(file, 'latin1'), /owner-hash-to-forget|HANDLE-TO-FORGET/);
  }
  assert.equal(statSync(`${path}-wal`).size, 0);

  anonymous.reserve('owner-b', () => 'NEW');
  assert.equal(anonymous.byHandle('NEW')?.handle, 'NEW');
  db.close();
});

test('a database from before deliveries recorded their files gets the column, and its deliveries none', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agora-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE deliveries (team_message_ts TEXT PRIMARY KEY, target_channel TEXT NOT NULL, target_ts TEXT,
            sent_by TEXT NOT NULL, sent_at INTEGER NOT NULL, deleted_at INTEGER);
            INSERT INTO deliveries VALUES ('1.0', 'D1', '2.0', 'U9', 1000, NULL);`);
  old.close();
  const db = openDatabase(path);
  assert.deepEqual(new Deliveries(db).get('1.0')?.fileIds, []);
  db.close();
});

test('a database from before relays recorded the notice naming files gets the column, and its relays none', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agora-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE relays (dm_channel TEXT NOT NULL, dm_ts TEXT NOT NULL, team_channel TEXT NOT NULL, team_ts TEXT NOT NULL,
            notice_ts TEXT, file_ids TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (dm_channel, dm_ts));
            INSERT INTO relays VALUES ('D1', '5.0', 'CTEAM', '1.0', NULL, '[]', 1000);`);
  old.close();
  const db = openDatabase(path);
  assert.equal(new Relays(db).get('D1', '5.0')?.problemsTs, null);
  db.close();
});
