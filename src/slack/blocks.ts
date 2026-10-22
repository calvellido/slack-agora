import type { ContextBlock, KnownBlock, RichTextBlock, SectionBlock } from '@slack/types';

// Small Block Kit pieces shared by every feature.

export function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

/** Text, such as a file name, made safe to put in mrkdwn, where &, < and > are special. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Block Kit has no spacing of its own: a blank section adds a line's height. */
export function spacer(): SectionBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: ' ' } };
}

/** A copy of someone's message: its rich text, or else its plain text. */
export function messageBody(message: RichTextBlock[], fallback = ''): KnownBlock[] {
  if (message.length > 0) return message;
  return fallback ? [{ type: 'section', text: { type: 'mrkdwn', text: fallback.slice(0, 3000) } }] : [];
}

/** A header line followed by a copy of someone's message. */
export function quoted(header: string, message: RichTextBlock[], fallback = ''): KnownBlock[] {
  return [context(header), ...messageBody(message, fallback)];
}

/** A date each viewer sees in their own timezone and language. */
export function slackDate(ts: string): string {
  const seconds = Math.floor(Number(ts));
  const fallback = new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
  return `<!date^${seconds}^{date_short_pretty} {time}|${fallback} UTC>`;
}

/** Slack rejects modal titles longer than 24 characters, and a bot name can make them longer. */
export function modalTitle(text: string): { type: 'plain_text'; text: string } {
  return { type: 'plain_text', text: text.length > 24 ? `${text.slice(0, 23)}…` : text };
}
