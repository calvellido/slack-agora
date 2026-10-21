import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from './index.ts';

const dm = { kind: 'dm', userId: 'U1', targetChannel: 'D1', targetThreadTs: null } as const;

test('switching the team channel starts fresh conversations', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'inbox-store-'));
  try {
    const path = join(dir, 'agora.db');
    const first = new Store(path, 'C1');
    first.conversations.create({ ...dm, teamThreadTs: '1.0' }, 1_000);
    const anon = first.anonymous.reserve('owner-a', () => 'AAAA', 1_000);
    first.anonymous.setThread(anon.id, '2.0');
    first.close();

    const second = new Store(path, 'C2');
    assert.equal(second.conversations.latestDm('D1', 0), undefined);
    assert.equal(second.conversations.byTeamThread('1.0'), undefined);
    assert.equal(second.anonymous.byTeamThread('2.0'), undefined);
    assert.equal(second.anonymous.byHandle('AAAA'), undefined);
    assert.deepEqual(second.anonymous.forOwner('owner-a', 10), []);
    assert.equal(second.anonymous.openCount('owner-a'), 0);
    assert.deepEqual(second.anonymous.expire(2_000, 3_000).map((c) => c.teamChannel), ['C1']);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the heartbeat is kept between starts', () => {
  const store = new Store(':memory:', 'C1');
  assert.equal(store.heartbeat.last(), undefined);
  store.heartbeat.beat(1_000);
  store.heartbeat.beat(2_000);
  assert.equal(store.heartbeat.last(), 2_000);
});
