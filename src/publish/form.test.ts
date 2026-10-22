import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { describeProblems, filesInForm } from '#src/slack/files.ts';
import { attached } from '#src/slack/testing.ts';
import { fileErrors, originalInForm, publishView } from './form.ts';

const t = stringsIn('en', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });

test('the posting form takes a message, files, or both, with the original message\'s files ticked to untick', () => {
  const view = publishView(t, 'CTEAM', { original: [{ id: 'F1', name: 'acta.pdf' }, { id: 'F2', name: 'foto.jpg' }] });
  type Input = { block_id: string; optional?: boolean; element: Record<string, unknown> };
  const inputs = view.blocks.filter((b) => b.type === 'input') as unknown as Input[];
  assert.deepEqual(
    inputs.map((b) => [b.block_id, b.element.type, b.optional]),
    [
      ['channel', 'conversations_select', true],
      ['people', 'multi_users_select', true],
      ['message', 'rich_text_input', true],
      ['original', 'checkboxes', true],
      ['attachments', 'file_input', true],
    ],
  );
  const original = inputs.find((b) => b.block_id === 'original')!.element;
  assert.deepEqual(original.initial_options, original.options);
  assert.ok(!publishView(t, 'CTEAM', {}).blocks.some((b) => b.block_id === 'original'));

  assert.deepEqual(originalInForm({ original: { files: { selected_options: [{ value: 'F2' }] } } }), ['F2']);
  assert.deepEqual(originalInForm({}), []);
  const photo = attached('foto.jpg');
  assert.deepEqual(filesInForm({ attachments: { files: { files: [photo] } } }), [photo]);
  assert.deepEqual(filesInForm({}), []);
});

test("files that wouldn't be posted stop the form, under the field they came from", () => {
  const big = attached('video.mp4', { size: 50 * 1024 * 1024 });
  const pdf = attached('acta.pdf');
  const photo = attached('foto.jpg');
  assert.deepEqual(fileErrors(t, { attached: [photo, pdf], original: [photo] }, false), {});
  assert.deepEqual(fileErrors(t, { attached: [big, photo], original: [pdf] }, true), {
    attachments: t.publish.form.cantPost({ list: describeProblems(t, [{ name: 'video.mp4', problem: 'tooLarge' }], 'team', 'plain') }),
    original: t.publish.form.cantPost({ list: describeProblems(t, [{ name: 'acta.pdf', problem: 'needsMember' }], 'team', 'plain') }),
  });
});
