import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from './store.ts';

const dm = { kind: 'dm', userId: 'U1', targetChannel: 'D1', targetThreadTs: null } as const;

test('latestDm only returns conversations active within the idle window', () => {
  const store = new Store(':memory:');
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
  const store = new Store(':memory:');
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

test('a team message can only be claimed for sending once', () => {
  const store = new Store(':memory:');
  assert.equal(store.claimDelivery('7.0', 'D1', 'U9'), true);
  assert.equal(store.claimDelivery('7.0', 'D1', 'U8'), false);

  store.releaseDelivery('7.0');
  assert.equal(store.claimDelivery('7.0', 'D1', 'U8'), true);
  store.completeDelivery('7.0', '8.0');
  store.releaseDelivery('7.0');
  assert.equal(store.delivery('7.0')?.targetTs, '8.0');
});

test('deliveries record what was sent and when it was deleted', () => {
  const store = new Store(':memory:');
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
