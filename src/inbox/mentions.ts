import type { App } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import { serialized } from '#src/lib/serialized.ts';
import type { Relay } from './relay.ts';

/** @mentions of the bot in other channels: each Slack thread becomes one conversation thread in the team channel. */
export function registerMentions(app: App, { config, store, i18n }: Deps, relay: Relay): void {
  app.event('app_mention', async ({ event, client }) => {
    const { channel, user, ts } = event;
    if (!user || event.bot_id || event.subtype) return;
    if (channel === config.teamChannelId || channel.startsWith('D')) return;
    const threadTs = event.thread_ts ?? ts;
    const message = { user, text: event.text, blocks: event.blocks, files: event.files?.length ?? 0 };

    await serialized(`${channel}:${threadTs}`, async () => {
      const existing = store.conversations.mentionThread(channel, threadTs);
      const header = async () =>
        i18n.team.mentionHeader(user, channel, (await client.chat.getPermalink({ channel, message_ts: ts })).permalink ?? '');
      const teamThreadTs = await relay(client, existing, header, message);
      if (teamThreadTs) {
        store.conversations.create({ kind: 'mention', userId: user, targetChannel: channel, targetThreadTs: threadTs, teamThreadTs });
      }
    });
  });
}
