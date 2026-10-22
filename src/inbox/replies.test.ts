import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { Notices } from '#src/slack/notices.ts';
import { attached, fakeFileApi, serveFiles, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerReplies } from './replies.ts';

let server: ReturnType<typeof serveFiles>;
beforeEach(() => (server = serveFiles()));
afterEach(() => server.restore());

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };

/** The team channel with a DM conversation in thread 1.0, and the replies the team wrote in it. */
function setup(replies: Record<string, Record<string, unknown>>) {
  const calls: Call[] = [];
  let ts = 100;
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return { ok: true, ts: `${++ts}.0`, message: { thread_ts: args.thread_ts } };
  };
  const client = {
    token: 'xoxb-test',
    conversations: {
      replies: async ({ ts: at }: { ts: string }) => ({ messages: [{ ts: at, thread_ts: '1.0', user: 'UTEAM', ...replies[at] }] }),
    },
    chat: {
      postMessage: record('chat.postMessage'),
      postEphemeral: record('chat.postEphemeral'),
      delete: record('chat.delete'),
    },
    reactions: { add: record('reactions.add'), remove: record('reactions.remove') },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
    files: fakeFileApi(calls),
  } as unknown as WebClient;
  const store = new Store(':memory:', 'CTEAM');
  store.conversations.create({ kind: 'dm', userId: 'U1', targetChannel: 'D1', targetThreadTs: null, teamThreadTs: '1.0' });
  const deps = {
    config: { teamChannelId: 'CTEAM', sendEmoji: 'outbox_tray', deleteEmoji: 'wastebasket' },
    store,
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const handlers: Record<string, (args: unknown) => Promise<void>> = {};
  const app = { event: (name: string, handler: (args: unknown) => Promise<void>) => (handlers[name] = handler) } as unknown as App;
  registerReplies(app, deps, { deleteReply: async () => false } as unknown as Anonymous);
  const react = (at: string, reaction: string) =>
    handlers.reaction_added!({ event: { item: { type: 'message', channel: 'CTEAM', ts: at }, reaction, user: 'UTEAM' }, client });
  return { calls, store, react };
}

test("a reply's files are sent with its text, and deleting the reply deletes both", async () => {
  const { calls, store, react } = setup({ '2.0': { text: 'Here it is', files: [attached('acta.pdf')] } });
  await react('2.0', 'outbox_tray');
  const sent = calls.find((c) => c.method === 'chat.postMessage')!;
  assert.deepEqual([sent.args.channel, sent.args.text], ['D1', 'Here it is']);
  const upload = calls.find((c) => c.method === 'files.completeUploadExternal')!;
  assert.deepEqual(upload.args, { files: [{ id: 'FCOPY1', title: 'acta.pdf' }], channel_id: 'D1' });
  assert.deepEqual(store.deliveries.get('2.0')?.fileIds, ['FCOPY1']);
  assert.ok(calls.some((c) => c.method === 'reactions.add' && c.args.name === 'white_check_mark'));

  const targetTs = store.deliveries.get('2.0')?.targetTs;
  assert.ok(targetTs);
  await react('2.0', 'wastebasket');
  assert.deepEqual(calls.find((c) => c.method === 'chat.delete')!.args, { channel: 'D1', ts: targetTs });
  assert.deepEqual(calls.find((c) => c.method === 'files.delete')!.args, { file: 'FCOPY1' });
  assert.ok(store.deliveries.get('2.0')?.deletedAt);
});

test('a reply of files only is sent, and files that can\'t go are told to the whole team in the thread', async () => {
  const { calls, store, react } = setup({ '3.0': { text: '', files: [attached('foto.png'), attached('big.zip', { size: 30 * 1024 * 1024 })] } });
  await react('3.0', 'outbox_tray');
  assert.equal(calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === 'D1').length, 0);
  assert.deepEqual(store.deliveries.get('3.0')?.fileIds, ['FCOPY1']);
  assert.equal(store.deliveries.get('3.0')?.targetTs, null);

  const t = stringsIn('en', names);
  const notice = calls.find((c) => c.method === 'chat.postMessage' && c.args.channel === 'CTEAM')!;
  assert.equal(notice.args.thread_ts, '1.0');
  assert.equal(notice.args.text, t.files.notSent({ list: describeProblems(t, [{ name: 'big.zip', problem: 'tooLarge' }], 'team') }));
});

test('the delete emoji on something the bot never sent says what it deletes', async () => {
  const { calls, react } = setup({ '4.0': { text: 'Just talking' } });
  await react('4.0', 'wastebasket');
  const t = stringsIn('en', names);
  const told = calls.find((c) => c.method === 'chat.postEphemeral')!.args;
  assert.deepEqual([told.user, told.thread_ts], ['UTEAM', '1.0']);
  assert.equal(told.text, t.inbox.reply.nothingToDelete({ sendEmoji: 'outbox_tray', deleteEmoji: 'wastebasket' }));
});
