import type { Logger } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { slackDate } from '#src/slack/blocks.ts';
import { Notices } from '#src/slack/notices.ts';
import { RECEIVED_EMOJI, catchUpWhileRunning, missedDms, type HistoryMessage } from './downtime.ts';
import type { Dms } from './dms.ts';

const BOT = 'UBOT';
const MINUTE = 60_000;

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

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The bot running with its timer ticking every `everyMs`, until the test ends, on a clock that `skip` moves forward,
 * as it does while the machine sleeps. Records the catch-ups (since when), the notices in the team channel, and the
 * log's warnings and errors.
 */
function setup(test: TestContext, everyMs: number, failures = 0) {
  const caughtUp: number[] = [];
  const posted: string[] = [];
  const warnings: string[] = [];
  const client = {
    chat: { postMessage: async (args: { text: string }) => (posted.push(args.text), { ok: true, ts: '1.0' }) },
  } as unknown as WebClient;
  let skipped = 0;
  const now = () => Date.now() + skipped;
  const notices = new Notices('CTEAM', 'Helpdesk · notices', 'robot_face');
  const deps = { i18n: new I18n(client, names, 'en'), notices } as unknown as Deps;
  // The first `failures` catch-ups fail, as when Slack can't be reached.
  const catchUp = async (_: WebClient, since: number) => {
    if (failures-- > 0) throw new Error('fetch failed');
    return (caughtUp.push(since), 0);
  };
  const dms = { catchUp } as unknown as Dms;
  const errors: string[] = [];
  const logger = { warn: (text: string) => warnings.push(text), error: (text: string) => errors.push(text) } as unknown as Logger;
  const connection = new EventEmitter();
  const gaps = catchUpWhileRunning(client, deps, dms, connection, logger, { everyMs, now });
  test.after(() => gaps.stop());
  const skip = (ms: number) => (skipped += ms);
  const backOnline = (duration: string) => t.inbox.backOnline({ duration, since: slackDate(String(caughtUp[0]! / 1000)), recovered: 0 });
  return { caughtUp, posted, warnings, errors, connection, gaps, now, skip, backOnline };
}

test('after the machine sleeps, the DMs since it fell asleep are caught up, and the team is told', async (t) => {
  const { caughtUp, posted, warnings, connection, now, skip, backOnline } = setup(t, 10);
  connection.emit('connected');
  await wait(25);
  const asleep = now();
  skip(2 * 60 * MINUTE);
  await wait(50);

  assert.equal(caughtUp.length, 1);
  assert.ok(caughtUp[0]! <= asleep && caughtUp[0]! > asleep - MINUTE);
  assert.deepEqual(posted, [backOnline('2 h')]);
  assert.deepEqual(warnings, ['The machine was asleep for about 2 h']);
});

test('after a sleep, the catch-up waits for Slack to connect again', async (t) => {
  const { caughtUp, posted, connection, now, skip } = setup(t, 10);
  connection.emit('connected');
  await wait(25);
  const asleep = now();
  skip(2 * 60 * MINUTE);
  // The client notices the connection is gone and opens another.
  connection.emit('reconnecting');
  await wait(35);
  assert.deepEqual(caughtUp, []);

  connection.emit('connected');
  await wait(5);
  assert.equal(caughtUp.length, 1);
  assert.ok(caughtUp[0]! <= asleep);
  assert.equal(posted.length, 1);
});

test('a connection lost for a while is caught up when it comes back, and a short one is not', async (t) => {
  const { caughtUp, posted, warnings, connection, now, skip, backOnline } = setup(t, 60 * MINUTE);
  connection.emit('connected');
  connection.emit('reconnecting');
  skip(30_000);
  connection.emit('connected');
  await wait(5);
  assert.deepEqual(caughtUp, []);

  const lost = now();
  connection.emit('reconnecting');
  skip(10 * MINUTE);
  connection.emit('connected');
  await wait(5);
  assert.equal(caughtUp.length, 1);
  assert.ok(caughtUp[0]! >= lost && caughtUp[0]! < lost + MINUTE);
  assert.deepEqual(posted, [backOnline('10 min')]);
  assert.deepEqual(warnings, ['The connection to Slack was lost for 10 min']);

  // Once caught up, a quick reconnection doesn't catch up again.
  connection.emit('reconnecting');
  connection.emit('connected');
  await wait(5);
  assert.equal(caughtUp.length, 1);
});

test('a catch-up that fails is tried again, and until then its DMs are missing, for the last heartbeat', async (t) => {
  const { caughtUp, errors, connection, gaps, now, skip } = setup(t, 10, 2);
  connection.emit('connected');
  await wait(25);
  const asleep = now();
  skip(2 * 60 * MINUTE);
  await wait(15);
  assert.ok(gaps.missingSince()! <= asleep);

  await wait(80);
  assert.equal(caughtUp.length, 1);
  assert.ok(caughtUp[0]! <= asleep);
  assert.equal(gaps.missingSince(), undefined);
  // Logged once, however often it fails.
  assert.deepEqual(errors, ['Catching up failed, and it will be tried again: fetch failed']);
});

test('while the connection is lost, its DMs are missing, but not while the bot first connects', async (t) => {
  const { caughtUp, warnings, connection, gaps, now, skip } = setup(t, 60 * MINUTE);
  connection.emit('reconnecting');
  skip(10 * MINUTE);
  assert.equal(gaps.missingSince(), undefined);
  connection.emit('connected');
  await wait(5);
  assert.deepEqual(caughtUp, []);
  assert.deepEqual(warnings, []);

  const lost = now();
  connection.emit('reconnecting');
  assert.ok(gaps.missingSince()! >= lost && gaps.missingSince()! < lost + MINUTE);
});
