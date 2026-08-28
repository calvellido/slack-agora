import type { RichTextBlock, RichTextBlockElement, RichTextElement } from '@slack/types';

/** The rich_text blocks of a message (what Slack clients send), without block_id so they can be reposted. */
export function richTextBlocks(blocks: readonly unknown[] | undefined): RichTextBlock[] {
  return (blocks ?? []).filter(isRichText).map(({ block_id: _, ...block }) => block);
}

function isRichText(block: unknown): block is RichTextBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'rich_text';
}

export function richTextFromPlain(text: string): RichTextBlock {
  return { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] };
}

/** mrkdwn fallback for the `text` field of a message (notifications, search). */
export function plainText(block: RichTextBlock): string {
  return block.elements
    .map(blockElement)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isBlank(block: RichTextBlock | undefined | null): boolean {
  return !block || plainText(block) === '';
}

function blockElement(element: RichTextBlockElement): string {
  switch (element.type) {
    case 'rich_text_section':
      return element.elements.map(inline).join('');
    case 'rich_text_list':
      return element.elements
        .map((item, i) => {
          const indent = '  '.repeat(element.indent ?? 0);
          const marker = element.style === 'ordered' ? `${i + 1}.` : '•';
          return `${indent}${marker} ${item.elements.map(inline).join('')}`;
        })
        .join('\n');
    case 'rich_text_quote':
      return element.elements
        .map(inline)
        .join('')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'rich_text_preformatted':
      return `\`\`\`\n${element.elements.map(inline).join('')}\n\`\`\``;
    default:
      return '';
  }
}

function inline(element: RichTextElement): string {
  switch (element.type) {
    case 'text':
      return escape(element.text);
    case 'link':
      return element.text ? `<${element.url}|${escape(element.text)}>` : `<${element.url}>`;
    case 'user':
      return `<@${element.user_id}>`;
    case 'channel':
      return `<#${element.channel_id}>`;
    case 'usergroup':
      return `<!subteam^${element.usergroup_id}>`;
    case 'broadcast':
      return `<!${element.range}>`;
    case 'emoji':
      return `:${element.name}:`;
    case 'date':
      return escape(element.fallback ?? '');
    case 'color':
      return element.value;
    default:
      return '';
  }
}

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
