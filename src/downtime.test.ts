import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECEIVED_EMOJI, formatDuration, missedDms, type HistoryMessage } from './downtime.ts';
import { Store } from './store.ts';

const BOT = 'UBOT';

test('missed DMs are the people’s messages without the received mark, oldest first', () => {
  const messages: HistoryMessage[] = [
    { ts: '3.0', user: 'U1', text: 'third' },
    { ts: '1.0', user: 'U1', text: 'first', reactions: [{ name: RECEIVED_EMOJI, users: [BOT], count: 1 }] },
    { ts: '2.0', user: 'U1', text: 'second', reactions: [{ name: RECEIVED_EMOJI, users: ['U1'], count: 1 }] },
    { ts: '4.0', user: BOT, text: 'from the bot' },
    { ts: '5.0', user: 'U2', bot_id: 'B1', text: 'another bot' },
    { ts: '6.0', user: 'U1', subtype: 'channel_join', text: 'joined' },
    { ts: '7.0', user: 'U1', subtype: 'file_share', text: 'with a file' },
  ];
  assert.deepEqual(missedDms(messages, BOT).map((m) => m.text), ['second', 'third', 'with a file']);
});

test('durations read the same in English and Spanish', () => {
  assert.equal(formatDuration(20_000), '1 min');
  assert.equal(formatDuration(7 * 60_000), '7 min');
  assert.equal(formatDuration(2 * 3_600_000 + 14 * 60_000), '2 h 14 min');
  assert.equal(formatDuration(3 * 3_600_000), '3 h');
  assert.equal(formatDuration(4 * 86_400_000 + 3_600_000), '4 d 1 h');
});

test('the heartbeat is kept between starts', () => {
  const store = new Store(':memory:', 'C1');
  assert.equal(store.lastAlive(), undefined);
  store.setLastAlive(1_000);
  store.setLastAlive(2_000);
  assert.equal(store.lastAlive(), 2_000);
});
