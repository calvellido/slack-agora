import type { App } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import { serialized } from '#src/lib/serialized.ts';
import { describeProblems } from '#src/slack/files.ts';
import type { Relay } from './relay.ts';

/** @mentions of the bot in other channels: each Slack thread becomes one conversation thread in the team channel. */
export function registerMentions(app: App, { config, store, i18n, notices }: Deps, relay: Relay): void {
  app.event('app_mention', async ({ event, client }) => {
    const { channel, user, ts } = event;
    if (!user || event.bot_id || event.subtype) return;
    if (channel === config.teamChannelId || channel.startsWith('D')) return;
    const threadTs = event.thread_ts ?? ts;
    const message = { user, text: event.text, blocks: event.blocks, files: event.files ?? [] };

    const { problems } = await serialized(`${channel}:${threadTs}`, async () => {
      const existing = store.conversations.mentionThread(channel, threadTs);
      const header = async () =>
        i18n.team.inbox.thread.mentionHeader({ user, channel, permalink: (await client.chat.getPermalink({ channel, message_ts: ts })).permalink ?? '' });
      const relayed = await relay(client, existing, header, message);
      if (relayed.started) {
        store.conversations.create({ kind: 'mention', userId: user, targetChannel: channel, targetThreadTs: threadTs, teamThreadTs: relayed.started });
      }
      return relayed;
    });

    // Files that didn't reach the team are told to the person where they wrote, only to them: in the mention's thread
    // if it was in one, else in the channel, where it shows without opening a thread.
    if (problems.length > 0) {
      const t = await i18n.forUser(user);
      const text = t.files.notReceived({ list: describeProblems(t, problems, 'person') });
      await notices.ephemeralToPerson(client, { channel, user, threadTs: event.thread_ts, text, username: t.notices.sender });
    }
  });
}
