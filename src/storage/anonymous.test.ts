import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from './index.ts';

function handles(...values: string[]) {
  return () => values.shift() ?? 'ZZZZ';
}

test('reserving retries taken handles and a failed post can be dropped', () => {
  const store = new Store(':memory:', 'C1');
  const first = store.anonymous.reserve('owner-a', handles('AAAA'));
  const second = store.anonymous.reserve('owner-b', handles('AAAA', 'AAAA', 'BBBB'));
  assert.equal(first.handle, 'AAAA');
  assert.equal(second.handle, 'BBBB');

  store.anonymous.drop(second.id);
  assert.equal(store.anonymous.byHandle('BBBB'), undefined);
  store.anonymous.setThread(first.id, '1.0');
  store.anonymous.drop(first.id);
  assert.equal(store.anonymous.byTeamThread('1.0')?.handle, 'AAAA');
});

test('an owner only sees their posted conversations, and only open ones count', () => {
  const store = new Store(':memory:', 'C1');
  const posted = store.anonymous.reserve('owner-a', handles('AAAA'), 1_000);
  store.anonymous.setThread(posted.id, '1.0');
  store.anonymous.reserve('owner-a', handles('BBBB'), 2_000);
  const other = store.anonymous.reserve('owner-b', handles('CCCC'));
  store.anonymous.setThread(other.id, '2.0');

  assert.deepEqual(store.anonymous.forOwner('owner-a', 10).map((c) => c.handle), ['AAAA']);
  assert.equal(store.anonymous.openCount('owner-a'), 1);
  assert.equal(store.anonymous.close(posted.id, 'team'), true);
  assert.equal(store.anonymous.close(posted.id, 'person'), false);
  assert.equal(store.anonymous.byId(posted.id)?.closedBy, 'team');
  assert.equal(store.anonymous.openCount('owner-a'), 0);
  assert.deepEqual(store.anonymous.forOwner('owner-a', 10).map((c) => c.handle), ['AAAA']);
});

test('purging forgets the owner and which messages were theirs', () => {
  const store = new Store(':memory:', 'C1');
  const c = store.anonymous.reserve('owner-a', handles('AAAA'));
  store.anonymous.setThread(c.id, '1.0');
  store.anonymous.addMessage('1.0', c.id, 'person', null, 1_000);
  assert.equal(store.anonymous.addMessage('1.5', c.id, 'team', 'U9', 2_000), true);
  assert.equal(store.anonymous.addMessage('1.5', c.id, 'team', 'U8', 3_000), false);
  assert.deepEqual(store.anonymous.messages(c.id).map((m) => [m.teamMessageTs, m.author, m.sentBy]), [
    ['1.0', 'person', null],
    ['1.5', 'team', 'U9'],
  ]);

  assert.equal(store.anonymous.markMessageDeleted('1.5'), true);
  assert.equal(store.anonymous.markMessageDeleted('1.5'), false);
  assert.deepEqual(store.anonymous.messages(c.id).map((m) => m.teamMessageTs), ['1.0']);

  store.anonymous.purge(c.id);
  assert.equal(store.anonymous.byId(c.id)?.owner, null);
  assert.equal(store.anonymous.message('1.0'), undefined);
  assert.deepEqual(store.anonymous.forOwner('owner-a', 10), []);
});

test('deleting removes every record of the conversation', () => {
  const store = new Store(':memory:', 'C1');
  const c = store.anonymous.reserve('owner-a', handles('AAAA'));
  store.anonymous.setThread(c.id, '1.0');
  store.anonymous.addMessage('1.0', c.id, 'person', null);
  store.anonymous.remove(c.id);
  assert.equal(store.anonymous.byId(c.id), undefined);
  assert.equal(store.anonymous.byTeamThread('1.0'), undefined);
  assert.equal(store.anonymous.message('1.0'), undefined);
});

test('idle conversations expire, and closed ones are purged after the grace period', () => {
  const store = new Store(':memory:', 'C1');
  const idle = store.anonymous.reserve('owner-a', handles('AAAA'), 1_000);
  store.anonymous.setThread(idle.id, '1.0');
  const active = store.anonymous.reserve('owner-a', handles('BBBB'), 1_000);
  store.anonymous.setThread(active.id, '2.0');
  store.anonymous.touch(active.id, 5_000);

  assert.deepEqual(store.anonymous.expire(3_000, 6_000).map((c) => c.handle), ['AAAA']);
  assert.deepEqual(store.anonymous.expire(3_000, 7_000), []);
  assert.equal(store.anonymous.byId(idle.id)?.closedBy, 'expired');

  const unposted = store.anonymous.reserve('owner-a', handles('CCCC'), 1_000);
  assert.deepEqual(store.anonymous.purgeClosed(1_000), []);
  assert.equal(store.anonymous.byId(unposted.id)?.handle, 'CCCC');
  assert.deepEqual(store.anonymous.purgeClosed(6_000), []);
  assert.equal(store.anonymous.byId(unposted.id), undefined);
  assert.deepEqual(store.anonymous.purgeClosed(6_001).map((c) => [c.handle, c.owner]), [['AAAA', null]]);
  assert.deepEqual(store.anonymous.purgeClosed(6_001), []);
  assert.equal(store.anonymous.byId(idle.id)?.owner, null);
  assert.equal(store.anonymous.byId(active.id)?.owner, 'owner-a');
});
