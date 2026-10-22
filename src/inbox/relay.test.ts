import type { KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { context } from '#src/slack/blocks.ts';
import { Notices } from '#src/slack/notices.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import { attached, fakeFileApi, serveFiles, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { createRelay, withBody } from './relay.ts';

let server: ReturnType<typeof serveFiles>;
beforeEach(() => (server = serveFiles()));
afterEach(() => server.restore());

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };

/** The line above relayed files other than images: grey and small, with the notices' emoji, in italics. */
const relayLine = (t: ReturnType<typeof stringsIn>) => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text: `:robot_face: _${t.files.relayed({ user: 'U1' })}_` }],
});

function setup() {
  const calls: Call[] = [];
  let ts = 0;
  const client = {
    token: 'xoxb-test',
    chat: {
      postMessage: async (args: Record<string, unknown>) => {
        calls.push({ method: 'chat.postMessage', args });
        return { ts: `${++ts}.0`, message: { thread_ts: args.thread_ts } };
      },
    },
    conversations: { open: async () => ({ channel: { id: 'D1' } }) },
    users: { info: async () => ({ user: { locale: 'en-US', profile: { display_name: 'Ana' } } }) },
    files: fakeFileApi(calls),
  } as unknown as WebClient;
  const deps = {
    config: { teamChannelId: 'CTEAM', sendEmoji: 'outbox_tray' },
    store: new Store(':memory:', 'CTEAM'),
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  return { client, calls, relay: createRelay(deps) };
}

test("a message's images go in a notice, its other files after it, and what couldn't go is told to the team and returned", async () => {
  const { client, calls, relay } = setup();
  const files = [attached('foto.jpg'), attached('acta.pdf'), attached('video.mp4', { size: 50 * 1024 * 1024 })];
  const relayed = await relay(client, undefined, () => 'Direct message from <@U1>', { user: 'U1', text: 'Hola', blocks: undefined, files });
  // The notice with the image is message 2.0, the copies are the image's and the PDF's, and 3.0 names the video.
  assert.deepEqual(relayed, {
    started: '1.0',
    ts: '1.0',
    noticeTs: '2.0',
    problemsTs: '3.0',
    fileIds: ['FCOPY1', 'FCOPY2'],
    problems: [{ name: 'video.mp4', problem: 'tooLarge' }],
  });
  // The copy of the message is marked, for edits to find it.
  const thread0 = calls.find((c) => c.method === 'chat.postMessage')!.args.blocks as KnownBlock[];
  assert.deepEqual(thread0.map((b) => b.block_id), [undefined, 'relayed-body-0', undefined]);

  const t = stringsIn('en', names);
  const images = calls.filter((c) => c.method === 'chat.postMessage')[1];
  const thread = calls.find((c) => c.method === 'files.completeUploadExternal' && c.args.channel_id);
  // The images, shown in a notice under the line saying whose they are.
  assert.equal(images!.args.thread_ts, '1.0');
  assert.equal(images!.args.username, 'Helpdesk · notices');
  assert.deepEqual((images!.args.blocks as unknown[]).slice(1), [{ type: 'image', slack_file: { id: 'FCOPY1' }, alt_text: 'foto.jpg' }]);
  assert.equal(images!.args.text, t.files.attached({ user: 'U1' }));
  // The PDF, uploaded as the bot itself, saying it is an automatic relay and, in its title, whose it is.
  assert.deepEqual(thread!.args, {
    files: [{ id: 'FCOPY2', title: t.files.relayedTitle({ name: 'acta.pdf', person: 'Ana' }) }],
    channel_id: 'CTEAM',
    thread_ts: '1.0',
    blocks: [relayLine(t)],
  });

  // The person is told by whoever relayed it, where they wrote.
  const posted = calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.args);
  const problems = describeProblems(t, [{ name: 'video.mp4', problem: 'tooLarge' }], 'team');
  assert.deepEqual(posted.slice(2).map((p) => [p.channel, p.thread_ts, p.text]), [['CTEAM', '1.0', t.files.notRelayed({ list: problems })]]);
});

test('files that fail on the last step are named as they were sent, not by the titles of their copies', async () => {
  const { client, relay } = setup();
  const failing = { ...client, files: { ...client.files, completeUploadExternal: async () => Promise.reject(new Error('boom')) } };
  const relayed = await relay(failing as unknown as WebClient, undefined, () => 'header', { user: 'U1', text: 'Hola', blocks: undefined, files: [attached('acta.pdf')] });
  assert.deepEqual(relayed.problems, [{ name: 'acta.pdf', problem: 'failed' }]);
});

test('files other than images need no notice before them, as their own message says whose they are', async () => {
  const { client, calls, relay } = setup();
  await relay(client, undefined, () => 'header', { user: 'U1', text: '', blocks: undefined, files: [attached('acta.pdf')] });
  assert.deepEqual(
    calls.filter((c) => c.method !== 'files.getUploadURLExternal').map((c) => [c.method, c.args.text ?? c.args.channel_id]),
    [
      ['chat.postMessage', 'header '],
      ['files.completeUploadExternal', 'CTEAM'],
    ],
  );
});

test("a relayed message's copy of the message is replaced by its block IDs, or by its place in older copies", () => {
  const header = context('<@U1> wrote:');
  const hint = context('To reply…');
  const marked = [header, { ...richTextFromPlain('Hola'), block_id: 'relayed-body-0' }, hint];
  const edited = { ...richTextFromPlain('Hola, equipo'), block_id: 'relayed-body-0' };
  assert.deepEqual(withBody(marked, [richTextFromPlain('Hola, equipo')], 'Hola, equipo'), {
    blocks: [header, edited, hint],
    text: '<@U1> wrote: Hola, equipo',
  });
  // Relayed by 2.2.0, without the marks: everything but the context blocks.
  assert.deepEqual(withBody([header, richTextFromPlain('Hola'), hint], [richTextFromPlain('Hola, equipo')], 'Hola, equipo').blocks, [
    header,
    edited,
    hint,
  ]);
  // A copy left without text gets it back under the header.
  assert.deepEqual(withBody([header, hint], [richTextFromPlain('Hola, equipo')], 'Hola, equipo').blocks, [header, edited, hint]);
});
