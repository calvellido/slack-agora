import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from './store.ts';

function handles(...values: string[]) {
  return () => values.shift() ?? 'ZZZZ';
}

test('reserving retries taken handles and a failed post can be dropped', () => {
  const store = new Store(':memory:');
  const first = store.reserveAnon('owner-a', handles('AAAA'));
  const second = store.reserveAnon('owner-b', handles('AAAA', 'AAAA', 'BBBB'));
  assert.equal(first.handle, 'AAAA');
  assert.equal(second.handle, 'BBBB');

  store.dropAnon(second.id);
  assert.equal(store.anonByHandle('BBBB'), undefined);
  store.setAnonThread(first.id, '1.0');
  store.dropAnon(first.id);
  assert.equal(store.anonByTeamThread('1.0')?.handle, 'AAAA');
});

test('an owner only sees their posted conversations, and only open ones count', () => {
  const store = new Store(':memory:');
  const posted = store.reserveAnon('owner-a', handles('AAAA'), 1_000);
  store.setAnonThread(posted.id, '1.0');
  store.reserveAnon('owner-a', handles('BBBB'), 2_000);
  const other = store.reserveAnon('owner-b', handles('CCCC'));
  store.setAnonThread(other.id, '2.0');

  assert.deepEqual(store.anonForOwner('owner-a', 10).map((c) => c.handle), ['AAAA']);
  assert.equal(store.openAnonCount('owner-a'), 1);
  assert.equal(store.closeAnon(posted.id, 'team'), true);
  assert.equal(store.closeAnon(posted.id, 'person'), false);
  assert.equal(store.anonById(posted.id)?.closedBy, 'team');
  assert.equal(store.openAnonCount('owner-a'), 0);
  assert.deepEqual(store.anonForOwner('owner-a', 10).map((c) => c.handle), ['AAAA']);
});

test('purging forgets the owner and which messages were theirs', () => {
  const store = new Store(':memory:');
  const c = store.reserveAnon('owner-a', handles('AAAA'));
  store.setAnonThread(c.id, '1.0');
  store.addAnonMessage('1.0', c.id, 'person', null, 1_000);
  assert.equal(store.addAnonMessage('1.5', c.id, 'team', 'U9', 2_000), true);
  assert.equal(store.addAnonMessage('1.5', c.id, 'team', 'U8', 3_000), false);
  assert.deepEqual(store.anonMessages(c.id).map((m) => [m.teamMessageTs, m.author, m.sentBy]), [
    ['1.0', 'person', null],
    ['1.5', 'team', 'U9'],
  ]);

  assert.equal(store.markAnonMessageDeleted('1.5'), true);
  assert.equal(store.markAnonMessageDeleted('1.5'), false);
  assert.deepEqual(store.anonMessages(c.id).map((m) => m.teamMessageTs), ['1.0']);

  store.purgeAnon(c.id);
  assert.equal(store.anonById(c.id)?.owner, null);
  assert.equal(store.anonMessage('1.0'), undefined);
  assert.deepEqual(store.anonForOwner('owner-a', 10), []);
});

test('deleting removes every record of the conversation', () => {
  const store = new Store(':memory:');
  const c = store.reserveAnon('owner-a', handles('AAAA'));
  store.setAnonThread(c.id, '1.0');
  store.addAnonMessage('1.0', c.id, 'person', null);
  store.deleteAnon(c.id);
  assert.equal(store.anonById(c.id), undefined);
  assert.equal(store.anonByTeamThread('1.0'), undefined);
  assert.equal(store.anonMessage('1.0'), undefined);
});

test('idle conversations expire, and closed ones are purged after the grace period', () => {
  const store = new Store(':memory:');
  const idle = store.reserveAnon('owner-a', handles('AAAA'), 1_000);
  store.setAnonThread(idle.id, '1.0');
  const active = store.reserveAnon('owner-a', handles('BBBB'), 1_000);
  store.setAnonThread(active.id, '2.0');
  store.touchAnon(active.id, 5_000);

  assert.deepEqual(store.expireAnon(3_000, 6_000).map((c) => c.handle), ['AAAA']);
  assert.deepEqual(store.expireAnon(3_000, 7_000), []);
  assert.equal(store.anonById(idle.id)?.closedBy, 'expired');

  const unposted = store.reserveAnon('owner-a', handles('CCCC'), 1_000);
  assert.deepEqual(store.purgeClosedAnon(1_000), []);
  assert.equal(store.anonById(unposted.id)?.handle, 'CCCC');
  assert.deepEqual(store.purgeClosedAnon(6_000), []);
  assert.equal(store.anonById(unposted.id), undefined);
  assert.deepEqual(store.purgeClosedAnon(6_001).map((c) => [c.handle, c.owner]), [['AAAA', null]]);
  assert.deepEqual(store.purgeClosedAnon(6_001), []);
  assert.equal(store.anonById(idle.id)?.owner, null);
  assert.equal(store.anonById(active.id)?.owner, 'owner-a');
});
