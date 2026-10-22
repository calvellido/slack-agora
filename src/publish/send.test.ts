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
import { createSender } from './send.ts';

let server: ReturnType<typeof serveFiles>;
beforeEach(() => (server = serveFiles()));
afterEach(() => server.restore());

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };

function setup() {
  const calls: Call[] = [];
  let ts = 0;
  const client = {
    token: 'xoxb-test',
    conversations: { info: async ({ channel }: { channel: string }) => ({ channel: { is_member: channel !== 'CPUBLIC' } }) },
    chat: {
      postMessage: async (args: Record<string, unknown>) => {
        calls.push({ method: 'chat.postMessage', args });
        return { ts: `${++ts}.0` };
      },
      getPermalink: async () => ({ permalink: 'https://slack.example/p1' }),
    },
    files: fakeFileApi(calls),
  } as unknown as WebClient;
  const store = new Store(':memory:', 'CTEAM');
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7, sendEmoji: 'outbox_tray' },
    store,
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  return { client, calls, store, send: createSender(deps) };
}

test("a post's files are uploaded after its text into a channel the bot is in", async () => {
  const { client, calls, store, send } = setup();
  await send.toChannel(client, 'UTEAM', 'CMEMBER', { message: richTextFromPlain('Notice'), files: [attached('acta.pdf')] });
  assert.deepEqual(calls.find((c) => c.method === 'chat.postMessage')!.args.channel, 'CMEMBER');
  assert.deepEqual(calls.find((c) => c.method === 'files.completeUploadExternal')!.args.channel_id, 'CMEMBER');
  const record = calls.filter((c) => c.method === 'chat.postMessage').at(-1)!;
  assert.equal(record.args.channel, 'CTEAM');
  // The record names the files posted, without copying them.
  const t = stringsIn('en', names);
  const files = { type: 'context', elements: [{ type: 'mrkdwn', text: t.files.included({ count: 1, list: 'acta.pdf' }) }] };
  assert.deepEqual((record.args.blocks as unknown[]).at(-1), files);
  assert.equal(store.deliveries.get('2.0')?.targetTs, '1.0');
  assert.deepEqual(store.deliveries.get('2.0')?.fileIds, ['FCOPY1']);
});

test('into a public channel the bot isn\'t in, images go in the message itself, and other files are left out', async () => {
  const { client, calls, store, send } = setup();
  await send.toChannel(client, 'UTEAM', 'CPUBLIC', { message: richTextFromPlain('Notice'), files: [attached('foto.jpg'), attached('acta.pdf')] });

  const [post, record] = calls.filter((c) => c.method === 'chat.postMessage');
  assert.equal(post!.args.channel, 'CPUBLIC');
  assert.deepEqual((post!.args.blocks as unknown[]).slice(1), [{ type: 'image', slack_file: { id: 'FCOPY1' }, alt_text: 'foto.jpg' }]);
  assert.ok(!calls.some((c) => c.method === 'files.completeUploadExternal' && c.args.channel_id));

  const t = stringsIn('en', names);
  const note = t.files.notPosted({ list: describeProblems(t, [{ name: 'acta.pdf', problem: 'needsMember' }], 'team') });
  const blocks = record!.args.blocks as { type: string; elements?: { text: string }[] }[];
  assert.deepEqual(
    blocks.filter((b) => b.type === 'context').slice(-2).map((b) => b.elements?.[0]?.text),
    [t.files.included({ count: 1, list: 'foto.jpg' }), note],
  );
  assert.deepEqual(store.deliveries.get('2.0')?.fileIds, ['FCOPY1']);
});

test('when nothing at all can be posted, the team is told what and why', async () => {
  const { client, calls, store, send } = setup();
  await send.toChannel(client, 'UTEAM', 'CPUBLIC', { files: [attached('acta.pdf')] });
  const t = stringsIn('en', names);
  const list = describeProblems(t, [{ name: 'acta.pdf', problem: 'needsMember' }], 'team');
  assert.deepEqual(
    calls.filter((c) => c.method === 'chat.postMessage').map((c) => [c.args.channel, c.args.text]),
    [['CTEAM', t.publish.record.nothingPosted({ poster: 'UTEAM', target: '<#CPUBLIC>', list })]],
  );
  assert.equal(store.deliveries.get('1.0'), undefined);
});
