import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { context, quoted, slackDate } from '#src/slack/blocks.ts';
import { postInThread } from '#src/slack/messages.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';
import type { Conversation } from '#src/storage/index.ts';

/** A message someone sent the bot, by DM or @mention. */
export interface Incoming {
  user: string;
  text: string;
  blocks: readonly unknown[] | undefined;
  files: number;
  /** Set when relaying, late, a message sent while the bot was down. */
  lateTs?: string;
}

/**
 * Posts a message in its conversation thread in the team channel. Without one (or if its thread was deleted), starts a
 * thread titled `header` and returns its ts, for the caller to record the new conversation.
 */
export type Relay = (
  client: WebClient,
  existing: Conversation | undefined,
  header: () => Promise<string> | string,
  message: Incoming,
) => Promise<string | undefined>;

export function createRelay({ config, store, i18n }: Deps): Relay {
  // Posted in the team channel, so in the team's language.
  const t = i18n.team;

  return async (client, existing, header, message) => {
    const body = (title: string) => {
      const blocks = quoted(title, richTextBlocks(message.blocks), message.text);
      if (message.files > 0) blocks.push(context(t.filesNotRelayed(message.files)));
      if (message.lateTs) blocks.push(context(t.lateRelay(slackDate(message.lateTs))));
      return { text: `${title} ${message.text}`, blocks };
    };

    if (existing) {
      const posted = await postInThread(client, {
        channel: config.teamChannelId,
        thread_ts: existing.teamThreadTs,
        ...body(t.followUp(message.user)),
        unfurl_links: false,
      });
      if (posted) {
        store.conversations.touch(existing.id);
        return undefined;
      }
    }
    const { text, blocks } = body(await header());
    blocks.push(context(t.replyHint(config.sendEmoji)));
    const parent = await client.chat.postMessage({ channel: config.teamChannelId, text, blocks, unfurl_links: false });
    return parent.ts;
  };
}
