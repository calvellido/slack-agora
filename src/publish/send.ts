import type { RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { serialized } from '#src/lib/serialized.ts';
import { DAY } from '#src/lib/time.ts';
import { context, quoted } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { plainText } from '#src/slack/richtext.ts';

/** Sending as the bot. Each send leaves a record in the team channel saying who sent it, which can delete it later. */
export interface Sender {
  toChannel(client: WebClient, poster: string, channel: string, message: RichTextBlock): Promise<void>;
  /** DMs someone as the bot. Their answers land in the same team channel thread as the message. */
  toPerson(client: WebClient, poster: string, user: string, message: RichTextBlock): Promise<void>;
}

export function createSender({ config, store, i18n, notices }: Deps): Sender {
  // The records go in the team channel, so in the team's language.
  const t = i18n.team;

  return {
    async toChannel(client, poster, channel, message) {
      let sentTs: string | undefined;
      try {
        sentTs = (await client.chat.postMessage({ channel, text: plainText(message), blocks: [message] })).ts;
      } catch (error) {
        await notices.post(client, { text: t.publish.record.failed({ poster, target: `<#${channel}>`, error: errorCode(error) }) });
        return;
      }
      if (!sentTs) return;
      const { permalink } = await client.chat.getPermalink({ channel, message_ts: sentTs });
      const header = t.publish.record.posted({ poster, channel, permalink: permalink ?? '' });
      const recordTs = await notices.post(client, { text: header, blocks: quoted(header, [message]) });
      if (recordTs) store.deliveries.record(recordTs, channel, sentTs, poster);
    },

    async toPerson(client, poster, user, message) {
      let dm: string | undefined;
      try {
        dm = (await client.conversations.open({ users: user })).channel?.id;
      } catch (error) {
        await notices.post(client, { text: t.publish.record.failed({ poster, target: `<@${user}>`, error: errorCode(error) }) });
        return;
      }
      if (!dm) return;
      const dmChannel = dm;

      await serialized(dmChannel, async () => {
        let sentTs: string | undefined;
        try {
          sentTs = (await client.chat.postMessage({ channel: dmChannel, text: plainText(message), blocks: [message] })).ts;
        } catch (error) {
          await notices.post(client, { text: t.publish.record.failed({ poster, target: `<@${user}>`, error: errorCode(error) }) });
          return;
        }
        if (!sentTs) return;

        const existing = store.conversations.latestDm(dmChannel, Date.now() - config.inboxIdleDays * DAY);
        const header = t.publish.record.dmStarted({ poster, user });
        const blocks = quoted(header, [message]);
        // In the person's ongoing conversation if there is one (and its thread still exists), else in a new one.
        let recordTs = existing && (await notices.post(client, { text: header, blocks, threadTs: existing.teamThreadTs }));
        if (existing && recordTs) {
          store.conversations.touch(existing.id);
        } else {
          const hint = context(t.inbox.thread.replyHint({ sendEmoji: config.sendEmoji }));
          recordTs = await notices.post(client, { text: header, blocks: [...blocks, hint] });
          if (!recordTs) return;
          store.conversations.create({ kind: 'dm', userId: user, targetChannel: dmChannel, targetThreadTs: null, teamThreadTs: recordTs });
        }
        store.deliveries.record(recordTs, dmChannel, sentTs, poster);
      });
    },
  };
}
