import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { deleteCopiesAndMessages, describeProblems, showImages, uploadCopies, type AttachedFile } from './files.ts';
import { attached, fakeFileApi, serveFiles, slackError, type Call } from './testing.ts';

let server: ReturnType<typeof serveFiles>;
beforeEach(() => (server = serveFiles()));
afterEach(() => server.restore());

function fakeSlack() {
  const calls: Call[] = [];
  return { client: { token: 'xoxb-test', files: fakeFileApi(calls) } as unknown as WebClient, calls };
}

const file = (name: string, fields: Partial<AttachedFile> = {}): AttachedFile => attached(name, fields);

test('files are copied into a thread in one upload, and those that can\'t be copied are told apart', async () => {
  const { client, calls } = fakeSlack();
  const copies = await uploadCopies(
    client,
    [
      file('acta.pdf'),
      file('video.mp4', { size: 50 * 1024 * 1024 }),
      file('drive.gdoc', { mode: 'external' }),
      file('old.png', { url_private_download: undefined }),
      file('page.pdf', { url_private_download: 'https://files.slack.example/signin' }),
    ],
    { channel: 'C1', threadTs: '1.0' },
  );
  assert.deepEqual(copies.fileIds, ['FCOPY1']);
  assert.deepEqual(copies.problems, [
    { name: 'video.mp4', problem: 'tooLarge' },
    { name: 'drive.gdoc', problem: 'notDownloadable' },
    { name: 'old.png', problem: 'notDownloadable' },
    { name: 'page.pdf', problem: 'noPermission' },
  ]);
  assert.deepEqual(server.downloads, [
    'https://files.slack.example/acta.pdf Bearer xoxb-test',
    'https://files.slack.example/signin Bearer xoxb-test',
  ]);
  const complete = calls.find((c) => c.method === 'files.completeUploadExternal')!.args;
  assert.deepEqual(complete, { files: [{ id: 'FCOPY1', title: 'acta.pdf' }], channel_id: 'C1', thread_ts: '1.0' });
});

test('a channel the bot isn\'t in refuses uploads', async () => {
  const { client } = fakeSlack();
  const copies = await uploadCopies(client, [file('acta.pdf')], { channel: 'CNOTIN' });
  assert.deepEqual(copies, { fileIds: [], problems: [{ name: 'acta.pdf', problem: 'needsMember' }] });
});

test('images are shown in a message once Slack has processed them, or their copies are deleted', async () => {
  const { client, calls } = fakeSlack();
  let attempts = 0;
  const shown = await showImages(
    client,
    [file('foto.jpg')],
    async (blocks) => {
      attempts++;
      if (attempts === 1) throw slackError('invalid_blocks');
      assert.deepEqual(blocks, [{ type: 'image', slack_file: { id: 'FCOPY1' }, alt_text: 'foto.jpg' }]);
      return '5.0';
    },
    [0],
  );
  assert.deepEqual(shown, { fileIds: ['FCOPY1'], problems: [], ts: '5.0' });
  // Completed without a destination, so it stays unshared until the message shows it.
  assert.deepEqual(calls.find((c) => c.method === 'files.completeUploadExternal')!.args, { files: [{ id: 'FCOPY1', title: 'foto.jpg' }] });

  const refused = await showImages(client, [file('otra.png')], async () => Promise.reject(slackError('invalid_blocks')), [0]);
  assert.deepEqual(refused, { fileIds: [], problems: [{ name: 'otra.png', problem: 'failed' }] });
  assert.deepEqual(calls.filter((c) => c.method === 'files.delete').map((c) => c.args.file), ['FCOPY2']);
});

test('problems are listed for the team with what to do, and for the person without the technical part', () => {
  const t = stringsIn('en', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });
  const problems = [
    { name: 'a<b>.pdf', problem: 'tooLarge' as const },
    { name: 'c.pdf', problem: 'noPermission' as const },
  ];
  assert.equal(
    describeProblems(t, problems, 'team'),
    `• ${t.files.tooLarge({ name: 'a&lt;b&gt;.pdf', max: 20 })}\n• ${t.files.noPermission({ name: 'c.pdf' })}`,
  );
  assert.equal(describeProblems(t, problems, 'person').split('\n')[1], `• ${t.files.failed({ name: 'c.pdf' })}`);
});

test('deleting copies also deletes the messages that show them, which would otherwise stay with a deleted file', async () => {
  const calls: Call[] = [];
  const client = {
    files: {
      info: async ({ file }: { file: string }) =>
        file === 'FGONE' ? Promise.reject(slackError('file_not_found')) : { file: { shares: { private: { CTEAM: [{ ts: '3.0' }] } } } },
      delete: async (args: Record<string, unknown>) => (calls.push({ method: 'files.delete', args }), { ok: true }),
    },
    chat: { delete: async (args: Record<string, unknown>) => (calls.push({ method: 'chat.delete', args }), { ok: true }) },
  } as unknown as WebClient;
  await deleteCopiesAndMessages(client, 'CTEAM', ['FCOPY1', 'FCOPY2', 'FGONE']);
  assert.deepEqual(calls.map((c) => [c.method, c.args.file ?? c.args.ts]), [
    ['files.delete', 'FCOPY1'],
    ['files.delete', 'FCOPY2'],
    ['files.delete', 'FGONE'],
    ['chat.delete', '3.0'],
  ]);
});
