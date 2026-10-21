import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECEIVED_EMOJI, missedDms, type HistoryMessage } from './downtime.ts';

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
