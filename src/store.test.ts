import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from './store.ts';

const dm = { kind: 'dm', userId: 'U1', targetChannel: 'D1', targetThreadTs: null } as const;

test('latestDm only returns conversations active within the idle window', () => {
  const store = new Store(':memory:', 'C1');
  const old = store.createConversation({ ...dm, teamThreadTs: '1.0' }, 1_000);
  assert.equal(store.latestDm('D1', 2_000), undefined);
  assert.equal(store.latestDm('D1', 500)?.id, old.id);

  const recent = store.createConversation({ ...dm, teamThreadTs: '2.0' }, 3_000);
  assert.equal(store.latestDm('D1', 500)?.id, recent.id);
  store.touch(old.id, 4_000);
  assert.equal(store.latestDm('D1', 500)?.id, old.id);
  assert.equal(store.latestDm('D2', 0), undefined);
});

test('conversations are found by team channel thread and by mention thread', () => {
  const store = new Store(':memory:', 'C1');
  const mention = store.createConversation({
    kind: 'mention',
    userId: 'U2',
    targetChannel: 'C1',
    targetThreadTs: '5.0',
    teamThreadTs: '6.0',
  });
  assert.deepEqual(store.byTeamThread('6.0'), mention);
  assert.deepEqual(store.mentionThread('C1', '5.0'), mention);
  assert.equal(store.mentionThread('C1', '6.0'), undefined);
});

test('switching the team channel starts fresh conversations', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'inbox-store-'));
  try {
    const path = join(dir, 'agora.db');
    const first = new Store(path, 'C1');
    first.createConversation({ ...dm, teamThreadTs: '1.0' }, 1_000);
    const anon = first.reserveAnon('owner-a', () => 'AAAA', 1_000);
    first.setAnonThread(anon.id, '2.0');
    first.close();

    const second = new Store(path, 'C2');
    assert.equal(second.latestDm('D1', 0), undefined);
    assert.equal(second.byTeamThread('1.0'), undefined);
    assert.equal(second.anonByTeamThread('2.0'), undefined);
    assert.equal(second.anonByHandle('AAAA'), undefined);
    assert.deepEqual(second.anonForOwner('owner-a', 10), []);
    assert.equal(second.openAnonCount('owner-a'), 0);
    assert.deepEqual(second.expireAnon(2_000, 3_000).map((c) => c.teamChannel), ['C1']);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a team message can only be claimed for sending once', () => {
  const store = new Store(':memory:', 'C1');
  assert.equal(store.claimDelivery('7.0', 'D1', 'U9'), true);
  assert.equal(store.claimDelivery('7.0', 'D1', 'U8'), false);

  store.releaseDelivery('7.0');
  assert.equal(store.claimDelivery('7.0', 'D1', 'U8'), true);
  store.completeDelivery('7.0', '8.0');
  store.releaseDelivery('7.0');
  assert.equal(store.delivery('7.0')?.targetTs, '8.0');
});

test('deliveries record what was sent and when it was deleted', () => {
  const store = new Store(':memory:', 'C1');
  store.recordDelivery('9.0', 'C1', '10.0', 'U9', 1_000);
  assert.deepEqual(store.delivery('9.0'), {
    teamMessageTs: '9.0',
    targetChannel: 'C1',
    targetTs: '10.0',
    sentBy: 'U9',
    sentAt: 1_000,
    deletedAt: null,
  });
  store.markDeleted('9.0', 2_000);
  assert.equal(store.delivery('9.0')?.deletedAt, 2_000);
});
