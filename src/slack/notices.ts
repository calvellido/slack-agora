import type { KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import { context } from './blocks.ts';
import { errorCode } from './errors.ts';
import { postInThread } from './messages.ts';

/**
 * Everything the bot posts on its own, kept apart from what the team says as the bot: what it relays into the team
 * channel, what it reports there, and its automatic messages to people. These go under a name and icon of their own
 * (which needs the chat:write.customize scope), so that the bot's own identity is only ever the team's voice. Short
 * notices show as a small grey line; relayed messages keep their own layout.
 */
export class Notices {
  #channel: string;
  #emoji: string;
  #sender: { username: string; icon_emoji: string };

  /** `username` is the sender's name in the team's language. */
  constructor(channel: string, username: string, emoji: string) {
    this.#channel = channel;
    this.#emoji = `:${emoji}:`;
    this.#sender = { username, icon_emoji: this.#emoji };
  }

  /**
   * Posts a notice in the team channel, or in one of its threads, and returns its ts. `blocks` replaces the grey line,
   * for notices that quote a message. In a thread that no longer exists, nothing is posted.
   */
  async post(client: WebClient, notice: { text: string; threadTs?: string; blocks?: KnownBlock[] }): Promise<string | undefined> {
    const message = {
      channel: this.#channel,
      text: notice.text,
      blocks: notice.blocks ?? [context(notice.text)],
      unfurl_links: false,
      ...this.#sender,
    };
    if (!notice.threadTs) return (await client.chat.postMessage(message)).ts;
    return postInThread(client, { ...message, thread_ts: notice.threadTs });
  }

  /**
   * An automatic message to someone in their DM with the bot; `username` is the sender's name in their language.
   * `blocks` replaces the grey line, for messages that quote what the person wrote.
   */
  async toPerson(
    client: WebClient,
    message: { channel: string; text: string; username: string; blocks?: KnownBlock[] },
  ): Promise<void> {
    await client.chat.postMessage({
      channel: message.channel,
      text: message.text,
      blocks: message.blocks ?? [context(message.text)],
      username: message.username,
      icon_emoji: this.#emoji,
    });
  }

  /** A notice only `user` sees, in the team channel or one of its threads. */
  async ephemeral(client: WebClient, notice: { user: string; text: string; threadTs?: string }): Promise<void> {
    await client.chat.postEphemeral({
      channel: this.#channel,
      user: notice.user,
      thread_ts: notice.threadTs,
      text: notice.text,
      blocks: [context(notice.text)],
      ...this.#sender,
    });
  }
}

export const DEFAULT_NOTICE_EMOJI = 'robot_face';

/**
 * The notices' icon: `wanted` if the workspace has it, as a standard or custom emoji, or the robot otherwise, so a
 * missing custom emoji never leaves notices with the bot's own avatar. If Slack can't be asked, `wanted` is kept.
 */
export async function noticeEmoji(client: WebClient, wanted: string): Promise<{ emoji: string; warning?: string }> {
  if (wanted === DEFAULT_NOTICE_EMOJI) return { emoji: wanted };
  try {
    const { emoji, categories } = await client.emoji.list({ include_categories: true });
    const known = new Set([...Object.keys(emoji ?? {}), ...(categories ?? []).flatMap((c) => c.emoji_names ?? [])]);
    if (known.has(wanted)) return { emoji: wanted };
    return {
      emoji: DEFAULT_NOTICE_EMOJI,
      warning: `NOTICE_EMOJI :${wanted}: is not an emoji in this workspace; notices use :${DEFAULT_NOTICE_EMOJI}: instead`,
    };
  } catch (error) {
    return { emoji: wanted, warning: `Could not check that NOTICE_EMOJI :${wanted}: exists (${errorCode(error)})` };
  }
}
