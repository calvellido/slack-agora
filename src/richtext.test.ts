import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RichTextBlock } from '@slack/types';
import { isBlank, plainText, richTextBlocks, richTextFromPlain } from './richtext.ts';

const message: RichTextBlock = {
  type: 'rich_text',
  block_id: 'abc',
  elements: [
    {
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'Hola ' },
        { type: 'user', user_id: 'U1' },
        { type: 'text', text: ', mira <esto> & ' },
        { type: 'link', url: 'https://example.com', text: 'el acta' },
        { type: 'emoji', name: 'wave' },
        { type: 'text', text: '\n' },
      ],
    },
    {
      type: 'rich_text_list',
      style: 'ordered',
      elements: [
        { type: 'rich_text_section', elements: [{ type: 'text', text: 'uno' }] },
        { type: 'rich_text_section', elements: [{ type: 'text', text: 'dos' }] },
      ],
    },
    { type: 'rich_text_quote', elements: [{ type: 'text', text: 'cita\nlarga' }] },
  ],
};

test('plainText renders mrkdwn fallback text', () => {
  assert.equal(
    plainText(message),
    'Hola <@U1>, mira &lt;esto&gt; &amp; <https://example.com|el acta>:wave:\n\n1. uno\n2. dos\n> cita\n> larga',
  );
});

test('richTextBlocks keeps rich_text blocks only and drops block_id', () => {
  const blocks = richTextBlocks([{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }, message, null]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.block_id, undefined);
  assert.deepEqual(blocks[0]?.elements, message.elements);
  assert.deepEqual(richTextBlocks(undefined), []);
});

test('richTextFromPlain and isBlank', () => {
  assert.equal(plainText(richTextFromPlain('hola')), 'hola');
  assert.equal(isBlank(richTextFromPlain('  \n ')), true);
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank(message), false);
});
