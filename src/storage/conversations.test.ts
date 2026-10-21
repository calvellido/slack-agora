import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from './index.ts';

const dm = { kind: 'dm', userId: 'U1', targetChannel: 'D1', targetThreadTs: null } as const;

test('latestDm only returns conversations active within the idle window', () => {
  const store = new Store(':memory:', 'C1');
  const old = store.conversations.create({ ...dm, teamThreadTs: '1.0' }, 1_000);
  assert.equal(store.conversations.latestDm('D1', 2_000), undefined);
  assert.equal(store.conversations.latestDm('D1', 500)?.id, old.id);

  const recent = store.conversations.create({ ...dm, teamThreadTs: '2.0' }, 3_000);
  assert.equal(store.conversations.latestDm('D1', 500)?.id, recent.id);
  store.conversations.touch(old.id, 4_000);
  assert.equal(store.conversations.latestDm('D1', 500)?.id, old.id);
  assert.equal(store.conversations.latestDm('D2', 0), undefined);
});

test('conversations are found by team channel thread and by mention thread', () => {
  const store = new Store(':memory:', 'C1');
  const mention = store.conversations.create({
    kind: 'mention',
    userId: 'U2',
    targetChannel: 'C1',
    targetThreadTs: '5.0',
    teamThreadTs: '6.0',
  });
  assert.deepEqual(store.conversations.byTeamThread('6.0'), mention);
  assert.deepEqual(store.conversations.mentionThread('C1', '5.0'), mention);
  assert.equal(store.conversations.mentionThread('C1', '6.0'), undefined);
});

test('a team message can only be claimed for sending once', () => {
  const store = new Store(':memory:', 'C1');
  assert.equal(store.deliveries.claim('7.0', 'D1', 'U9'), true);
  assert.equal(store.deliveries.claim('7.0', 'D1', 'U8'), false);

  store.deliveries.release('7.0');
  assert.equal(store.deliveries.claim('7.0', 'D1', 'U8'), true);
  store.deliveries.complete('7.0', '8.0');
  store.deliveries.release('7.0');
  assert.equal(store.deliveries.get('7.0')?.targetTs, '8.0');
});

test('deliveries record what was sent and when it was deleted', () => {
  const store = new Store(':memory:', 'C1');
  store.deliveries.record('9.0', 'C1', '10.0', 'U9', 1_000);
  assert.deepEqual(store.deliveries.get('9.0'), {
    teamMessageTs: '9.0',
    targetChannel: 'C1',
    targetTs: '10.0',
    sentBy: 'U9',
    sentAt: 1_000,
    deletedAt: null,
  });
  store.deliveries.markDeleted('9.0', 2_000);
  assert.equal(store.deliveries.get('9.0')?.deletedAt, 2_000);
});
