import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { Notices } from '#src/slack/notices.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import { attached, fakeFileApi, serveFiles, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerDms, type Dms } from './dms.ts';
import { createRelay } from './relay.ts';
import { registerWrite } from './write.ts';

test('a written message is relayed as a DM, with a copy in the DM, and the next one continues its thread', async () => {
  const posts: { channel: string; text: string; thread_ts?: string }[] = [];
  const client = {
    conversations: { open: async () => ({ channel: { id: 'D1' } }) },
    chat: {
      postMessage: async (message: { channel: string; text: string; thread_ts?: string }) => {
        posts.push(message);
        return { ts: `${posts.length}.0`, message: { thread_ts: message.thread_ts } };
      },
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const app = { event: () => {}, logger: { warn: () => {} } } as unknown as App;
  const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
  const i18n = new I18n(client, names, 'en');
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7, sendEmoji: 'outbox_tray' },
    store: new Store(':memory:', 'CTEAM'),
    i18n,
    bot: { userId: 'UBOT' },
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const dms = registerDms(app, deps, createRelay(deps));

  await dms.write(client, 'U1', { message: richTextFromPlain('Hello team'), files: [] });
  assert.deepEqual(posts.map((p) => [p.channel, p.thread_ts]), [['CTEAM', undefined], ['D1', undefined]]);
  const t = stringsIn('en', names);
  assert.equal(posts[0]!.text, `${t.inbox.thread.dmHeader({ user: 'U1' })} Hello team`);
  assert.equal(posts[1]!.text, `${t.inbox.dm.written} Hello team`);
  assert.ok(JSON.stringify(posts[1]).includes(JSON.stringify(t.inbox.dm.ack).slice(1, -1)));
  assert.equal(deps.store.conversations.latestDm('D1', 0)?.teamThreadTs, '1.0');

  await dms.write(client, 'U1', { message: richTextFromPlain('One more thing'), files: [] });
  assert.deepEqual(posts.slice(2).map((p) => [p.channel, p.thread_ts]), [['CTEAM', '1.0'], ['D1', undefined]]);
  assert.ok(!JSON.stringify(posts[3]).includes(JSON.stringify(t.inbox.dm.ack).slice(1, -1)));
});

test("a written message's files reach the thread, and the person's copy names them", async (t) => {
  const server = serveFiles();
  t.after(() => server.restore());
  const calls: Call[] = [];
  const posts: { channel: string; text: string; blocks?: unknown[] }[] = [];
  const client = {
    token: 'xoxb-test',
    conversations: { open: async () => ({ channel: { id: 'D1' } }) },
    chat: {
      postMessage: async (message: { channel: string; text: string; thread_ts?: string }) => {
        posts.push(message);
        return { ts: `${posts.length}.0`, message: { thread_ts: message.thread_ts } };
      },
    },
    users: { info: async () => ({ user: { locale: 'en-US', profile: { display_name: 'Ana' } } }) },
    files: fakeFileApi(calls),
  } as unknown as WebClient;
  const app = { event: () => {}, logger: { warn: () => {} } } as unknown as App;
  const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7, sendEmoji: 'outbox_tray' },
    store: new Store(':memory:', 'CTEAM'),
    i18n: new I18n(client, names, 'en'),
    bot: { userId: 'UBOT' },
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const dms = registerDms(app, deps, createRelay(deps));

  await dms.write(client, 'U1', { files: [attached('acta.pdf')] });
  const upload = calls.find((c) => c.method === 'files.completeUploadExternal')!;
  assert.deepEqual([upload.args.channel_id, upload.args.thread_ts], ['CTEAM', '1.0']);
  const strings = stringsIn('en', names);
  const copy = posts.find((p) => p.channel === 'D1')!;
  const named = { type: 'context', elements: [{ type: 'mrkdwn', text: strings.files.included({ count: 1, list: 'acta.pdf' }) }] };
  assert.ok(copy.blocks?.some((b) => JSON.stringify(b) === JSON.stringify(named)));
});

test("files that didn't reach the team are returned, and the person's copy names only those that did", async () => {
  const posts: { channel: string; text: string; blocks?: unknown[] }[] = [];
  const client = {
    conversations: { open: async () => ({ channel: { id: 'D1' } }) },
    chat: { postMessage: async (message: (typeof posts)[number]) => (posts.push(message), { ts: '9.0' }) },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const app = { event: () => {}, logger: { warn: () => {} } } as unknown as App;
  const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7 },
    store: new Store(':memory:', 'CTEAM'),
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const problems = [{ name: 'acta.pdf', problem: 'failed' as const }];
  const dms = registerDms(app, deps, async () => ({ started: '1.0', ts: '1.0', fileIds: [], problems }));

  assert.deepEqual(await dms.write(client, 'U1', { files: [attached('foto.jpg'), attached('acta.pdf')] }), problems);
  const t = stringsIn('en', names);
  const lines = (posts[0]!.blocks as { type: string; elements?: { text: string }[] }[]).filter((b) => b.type === 'context');
  assert.deepEqual(lines.map((b) => b.elements?.[0]?.text), [
    t.inbox.dm.written,
    t.files.included({ count: 1, list: 'foto.jpg' }),
    t.files.notReceived({ list: describeProblems(t, problems, 'person') }),
    t.inbox.dm.ack,
  ]);
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sending the write form with a message, waiting `sendWaitMs` for `write`: what the form answered Slack, and the texts
 * it was updated with after.
 */
async function submit(write: Dms['write'], sendWaitMs: number) {
  let handler: (args: unknown) => Promise<void> = async () => {};
  const app = {
    command: () => {},
    shortcut: () => {},
    action: () => {},
    view: (_id: string, registered: typeof handler) => (handler = registered),
    logger: { error: () => {} },
  } as unknown as App;
  type View = { blocks: { text?: { text: string } }[] };
  const updates: string[] = [];
  const client = {
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
    views: { update: async ({ view }: { view: View }) => (updates.push(view.blocks[0]!.text!.text), { ok: true }) },
  } as unknown as WebClient;
  const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
  registerWrite(app, { config: {}, i18n: new I18n(client, names, 'en') } as unknown as Deps, { write } as Dms, sendWaitMs);
  const acks: unknown[] = [];
  const values = { message: { message: { rich_text_value: richTextFromPlain('Hello team') } } };
  await handler({ ack: async (answer: unknown) => acks.push(answer), body: { user: { id: 'U1' } }, view: { id: 'V1', state: { values } }, client });
  const text = (answer: unknown) => (answer as { view?: View }).view?.blocks[0]?.text?.text;
  return { acks, texts: acks.map(text), updates, t: stringsIn('en', names) };
}

test('a message alone that reaches the team at once is answered as sent, and one that fails keeps the form, with the error', async () => {
  const sent = await submit(async () => [], 1_000);
  assert.deepEqual([sent.texts, sent.updates], [[sent.t.inbox.write.sent], []]);
  const failed = await submit(async () => Promise.reject(new Error('fatal_error')), 1_000);
  assert.deepEqual(failed.acks, [{ response_action: 'errors', errors: { message: failed.t.inbox.write.sendFailed } }]);
});

test('a message alone that takes longer than Slack waits for the answer says it is sending, and then how it went', async () => {
  const slow = await submit(async () => (await wait(50), []), 10);
  assert.deepEqual(slow.texts, [slow.t.inbox.write.sending({ files: 'no' })]);
  assert.deepEqual(slow.updates, [slow.t.inbox.write.sent]);
  const failed = await submit(async () => (await wait(50), Promise.reject(new Error('fatal_error'))), 10);
  assert.deepEqual(failed.updates, [failed.t.inbox.write.sendFailed]);
});
