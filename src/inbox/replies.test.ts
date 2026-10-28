import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { Notices } from '#src/slack/notices.ts';
import { attached, fakeFileApi, serveFiles, slackError, type Call } from '#src/slack/testing.ts';
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
      update: record('chat.update'),
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
  const edit = (at: string, before: string | undefined, after: string) =>
    handlers.message!({
      event: {
        channel: 'CTEAM',
        subtype: 'message_changed',
        message: { ts: at, user: 'UTEAM', thread_ts: '1.0', text: after, edited: { ts: '9.0' } },
        previous_message: before === undefined ? undefined : { ts: at, user: 'UTEAM', text: before },
      },
      client,
    });
  return { calls, store, react, edit, client };
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

test("a reply that went out is recorded even if telling the team about its files fails, so it can still be deleted", async () => {
  const { calls, store, react, client } = setup({ '7.0': { text: 'Here it is', files: [attached('big.zip', { size: 30 * 1024 * 1024 })] } });
  const post = client.chat.postMessage;
  client.chat.postMessage = (async (args: { channel: string }) => {
    if (args.channel === 'CTEAM') throw slackError('ratelimited');
    return post(args as never);
  }) as typeof post;
  await assert.rejects(react('7.0', 'outbox_tray'));
  const targetTs = store.deliveries.get('7.0')?.targetTs;
  assert.ok(targetTs);

  await assert.rejects(react('7.0', 'wastebasket'));
  assert.ok(calls.some((c) => c.method === 'chat.delete' && c.args.channel === 'D1' && c.args.ts === targetTs));
  assert.ok(store.deliveries.get('7.0')?.deletedAt);
});

test('the delete emoji on something the bot never sent says what it deletes', async () => {
  const { calls, react } = setup({ '4.0': { text: 'Just talking' } });
  await react('4.0', 'wastebasket');
  const t = stringsIn('en', names);
  const told = calls.find((c) => c.method === 'chat.postEphemeral')!.args;
  assert.deepEqual([told.user, told.thread_ts], ['UTEAM', '1.0']);
  assert.equal(told.text, t.inbox.reply.nothingToDelete({ sendEmoji: 'outbox_tray', deleteEmoji: 'wastebasket' }));
});

test('editing a reply already sent edits what was sent, and its author is told once', async () => {
  const { calls, react, edit } = setup({ '2.0': { text: 'Here it is' } });
  // Before it is sent, an edit is only the team's.
  await edit('2.0', 'Here it is', 'Here it is!');
  assert.ok(!calls.some((c) => c.method === 'chat.update' || c.method === 'chat.postEphemeral'));

  await react('2.0', 'outbox_tray');
  await edit('2.0', 'Here it is', 'Here it is, signed');
  await edit('2.0', 'Here it is, signed', 'Here it is, signed.');
  const updates = calls.filter((c) => c.method === 'chat.update').map((c) => [c.args.channel, c.args.text]);
  assert.deepEqual(updates, [['D1', 'Here it is, signed'], ['D1', 'Here it is, signed.']]);
  // Always with blocks, so Slack doesn't keep showing the old ones: here the text, as the edit had no rich text.
  const blocks = calls.find((c) => c.method === 'chat.update')!.args.blocks;
  assert.deepEqual(blocks, [{ type: 'section', text: { type: 'mrkdwn', text: 'Here it is, signed' } }]);
  const t = stringsIn('en', names);
  const told = calls.filter((c) => c.method === 'chat.postEphemeral').map((c) => [c.args.user, c.args.thread_ts, c.args.text]);
  assert.deepEqual(told, [['UTEAM', '1.0', t.inbox.reply.editSent]]);
});

test("an edit that can't be sent says why", async () => {
  const { calls, react, edit } = setup({ '3.0': { text: '', files: [attached('foto.png')] }, '4.0': { text: 'Hi' } });
  await react('3.0', 'outbox_tray');
  await edit('3.0', '', 'And a caption');
  await react('4.0', 'outbox_tray');
  await edit('4.0', 'Hi', ' ');
  const t = stringsIn('en', names);
  assert.deepEqual(calls.filter((c) => c.method === 'chat.postEphemeral').map((c) => c.args.text), [
    t.inbox.reply.editFilesOnly({ sendEmoji: 'outbox_tray' }),
    t.inbox.reply.editEmpty({ deleteEmoji: 'wastebasket' }),
  ]);
});

test('an edit made while the reply is still being sent waits for it, and is sent', async () => {
  const { calls, react, edit } = setup({ '5.0': { text: 'Here it is', files: [attached('acta.pdf')] } });
  const sending = react('5.0', 'outbox_tray');
  // Slack may leave out the message as it was.
  await edit('5.0', undefined, 'Here it is, signed');
  await sending;
  assert.deepEqual(calls.filter((c) => c.method === 'chat.update').map((c) => c.args.text), ['Here it is, signed']);
});

test('in an encrypted anonymous thread, the send emoji on any message points to the window, and the delete emoji says what it does there', async () => {
  const { calls, store, react } = setup({ '5.0': { thread_ts: '5.0', bot_id: 'BBOT', text: '🕶️' }, '6.0': { thread_ts: '5.0', bot_id: 'BBOT', text: '🕶️' } });
  const c = store.anonymous.reserve('owner-a', () => 'AAAA', 'kept-key');
  store.anonymous.setThread(c.id, '5.0');
  await react('6.0', 'outbox_tray');
  await react('5.0', 'outbox_tray');
  await react('6.0', 'wastebasket');
  const t = stringsIn('en', names);
  assert.deepEqual(calls.filter((c) => c.method === 'chat.postEphemeral').map((c) => c.args.text), [
    t.anonymous.team.replyFromWindow,
    t.anonymous.team.replyFromWindow,
    t.anonymous.team.nothingToDelete({ deleteEmoji: 'wastebasket' }),
  ]);
});
