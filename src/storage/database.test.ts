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
