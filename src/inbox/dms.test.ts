import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { Notices } from '#src/slack/notices.ts';
import { slackError, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerDms } from './dms.ts';
import type { HistoryMessage } from './downtime.ts';
import type { Relay } from './relay.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);

/** DMs to the bot, relayed by `relay`, with what the bot posts and reacts recorded. */
function setup(relay: Relay) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return { ok: true, ts: '99.0' };
  };
  const client = {
    chat: { postMessage: record('chat.postMessage') },
    reactions: { add: record('reactions.add') },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const handlers: Record<string, (args: unknown) => Promise<void>> = {};
  const app = {
    event: (name: string, handler: (args: unknown) => Promise<void>) => (handlers[name] = handler),
    logger: { error: () => {}, warn: () => {} },
  } as unknown as App;
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7 },
    store: new Store(':memory:', 'CTEAM'),
    i18n: new I18n(client, names, 'en'),
    bot: { userId: 'UBOT' },
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const dms = registerDms(app, deps, relay);
  const store = deps.store;
  const dm = (event: Record<string, unknown>) => handlers.message!({ event: { channel_type: 'im', channel: 'D1', ...event }, client });
  const told = () => calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.args.text);
  return { calls, store, dm, told, dms, client };
}

test("a DM that can't reach the team is not marked as received, and the person is told to send it again", async () => {
  const { calls, dm, told } = setup(async () => Promise.reject(slackError('not_in_channel')));
  await dm({ user: 'U1', ts: '5.0', text: 'Hola' });
  assert.deepEqual(told(), [t.inbox.relayFailed]);
  assert.ok(!calls.some((c) => c.method === 'reactions.add'));
});

test("a DM's files that didn't reach the team are told after the thanks", async () => {
  const problems = [{ name: 'big.zip', problem: 'tooLarge' as const }];
  const { calls, store, dm, told } = setup(async () => ({ started: '1.0', ts: '1.0', noticeTs: '2.0', problemsTs: '3.0', fileIds: ['FCOPY1'], problems }));
  await dm({ user: 'U1', ts: '5.0', text: 'Hola', subtype: 'file_share' });
  assert.deepEqual(told(), [t.inbox.dm.ack, t.files.notReceived({ list: describeProblems(t, problems, 'person') })]);
  assert.ok(calls.some((c) => c.method === 'reactions.add' && c.args.name === 'incoming_envelope'));
  // What it posted is kept, so the copy can follow the DM's edits and deletion.
  const { createdAt, ...copy } = store.relays.get('D1', '5.0')!;
  assert.ok(createdAt);
  assert.deepEqual(copy, { dmChannel: 'D1', dmTs: '5.0', teamChannel: 'CTEAM', teamTs: '1.0', noticeTs: '2.0', problemsTs: '3.0', fileIds: ['FCOPY1'] });
});

test("a DM whose copy can't be recorded is still thanked and marked, as the team has it", async () => {
  const { calls, store, dm, told } = setup(async () => ({ started: '1.0', ts: '1.0', fileIds: [], problems: [] }));
  store.relays.record = () => {
    throw new Error('database is locked');
  };
  await dm({ user: 'U1', ts: '5.0', text: 'Hola' });
  assert.deepEqual(told(), [t.inbox.dm.ack]);
  assert.ok(calls.some((c) => c.method === 'reactions.add'));
});

test('catching up reads every page of a DM since the bot went away, and relays what it missed oldest first', async () => {
  const relayed: string[] = [];
  const { dms, client, told } = setup(async (_, __, ___, message) => (relayed.push(message.text), { ts: '1.0', fileIds: [], problems: [] }));
  // Slack gives the latest messages first, and the earlier ones on the next page.
  const pages: Record<string, { messages: HistoryMessage[]; next?: string }> = {
    first: { messages: [{ ts: '30.0', user: 'U1', text: 'third' }, { ts: '20.0', user: 'U1', text: 'second' }], next: 'earlier' },
    earlier: { messages: [{ ts: '10.0', user: 'U1', text: 'first' }] },
  };
  Object.assign(client, {
    conversations: {
      list: async () => ({ channels: [{ id: 'D1', user: 'U1' }] }),
      history: async ({ cursor }: { cursor?: string }) => {
        const page = pages[cursor ?? 'first']!;
        return { messages: page.messages, response_metadata: { next_cursor: page.next ?? '' } };
      },
    },
  });
  assert.equal(await dms.catchUp(client, 5_000), 3);
  assert.deepEqual(relayed, ['first', 'second', 'third']);
  assert.deepEqual(told(), [t.inbox.dm.lateAck]);
});

test('a reply in a thread of the DM that is also sent to the DM is relayed and marked as received', async () => {
  const relayed: string[] = [];
  const { calls, dm } = setup(async (_, __, ___, message) => (relayed.push(message.text), { ts: '1.0', fileIds: [], problems: [] }));
  await dm({ user: 'U1', ts: '5.0', text: 'Also here', subtype: 'thread_broadcast', thread_ts: '4.0' });
  assert.deepEqual(relayed, ['Also here']);
  assert.ok(calls.some((c) => c.method === 'reactions.add' && c.args.timestamp === '5.0'));
});

test("catching up looks into the DM's threads with replies since, also those started before, as under the team's replies", async () => {
  const relayed: string[] = [];
  const { dms, client } = setup(async (_, __, ___, message) => (relayed.push(message.text), { ts: '1.0', fileIds: [], problems: [] }));
  const ago = (minutes: number) => (Date.now() / 1000 - minutes * 60).toFixed(6);
  const [reply, broadcast] = [ago(24 * 60), ago(2)];
  const history: HistoryMessage[] = [
    { ts: broadcast, user: 'U1', text: 'also in the DM', subtype: 'thread_broadcast', thread_ts: reply },
    { ts: ago(5), user: 'U1', text: 'in the DM' },
    { ts: ago(60), user: 'U1', text: 'before the bot went away' },
    { ts: ago(120), user: 'UBOT', text: 'an older reply', reply_count: 1, latest_reply: ago(90) },
    { ts: reply, user: 'UBOT', text: "the team's reply", reply_count: 4, latest_reply: ago(1) },
  ];
  const thread: HistoryMessage[] = [
    { ts: reply, user: 'UBOT', text: "the team's reply" },
    { ts: ago(30), user: 'U1', text: 'in the thread, before the bot went away' },
    { ts: broadcast, user: 'U1', text: 'also in the DM', subtype: 'thread_broadcast', thread_ts: reply },
    { ts: ago(1), user: 'U1', text: 'in the thread', thread_ts: reply },
  ];
  const looked: string[] = [];
  const since = (oldest: string) => (m: HistoryMessage) => Number(m.ts) >= Number(oldest);
  Object.assign(client, {
    conversations: {
      list: async () => ({ channels: [{ id: 'D1', user: 'U1' }] }),
      history: async ({ oldest }: { oldest: string }) => ({ messages: history.filter(since(oldest)) }),
      // Always with the thread's first message.
      replies: async ({ ts, oldest }: { ts: string; oldest: string }) => (looked.push(ts), { messages: thread.filter((m) => m.ts === ts || since(oldest)(m)) }),
    },
  });
  assert.equal(await dms.catchUp(client, Date.now() - 10 * 60_000), 3);
  assert.deepEqual(relayed, ['in the DM', 'also in the DM', 'in the thread']);
  assert.deepEqual(looked, [reply]);
});
