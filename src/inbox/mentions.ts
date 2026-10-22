import type { App } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { serialized } from '#src/lib/serialized.ts';
import { errorCode } from '#src/slack/errors.ts';
import { describeProblems } from '#src/slack/files.ts';
import { RECEIVED_EMOJI } from './downtime.ts';
import type { Relay, Relayed } from './relay.ts';

/**
 * @mentions of the bot in other channels: each Slack thread becomes one conversation thread in the team channel. The
 * mention is marked as received, as DMs are, and what the person needs to know, only they see, where they wrote.
 */
export function registerMentions(app: App, { config, store, i18n, notices }: Deps, relay: Relay): void {
  app.event('app_mention', async ({ event, client }) => {
    const { channel, user, ts } = event;
    if (!user || event.bot_id || event.subtype) return;
    if (channel === config.teamChannelId || channel.startsWith('D')) return;
    const threadTs = event.thread_ts ?? ts;
    const message = { user, text: event.text, blocks: event.blocks, files: event.files ?? [] };
    // In the mention's thread if it was in one, else in the channel, where it shows without opening a thread.
    const tell = async (t: Strings, text: string) =>
      notices.ephemeralToPerson(client, { channel, user, threadTs: event.thread_ts, text, username: t.notices.sender });

    let relayed: Relayed;
    try {
      relayed = await serialized(`${channel}:${threadTs}`, async () => {
        const existing = store.conversations.mentionThread(channel, threadTs);
        const header = async () =>
          i18n.team.inbox.thread.mentionHeader({ user, channel, permalink: (await client.chat.getPermalink({ channel, message_ts: ts })).permalink ?? '' });
        const result = await relay(client, existing, header, message);
        if (result.started) {
          store.conversations.create({ kind: 'mention', userId: user, targetChannel: channel, targetThreadTs: threadTs, teamThreadTs: result.started });
        }
        return result;
      });
    } catch (error) {
      app.logger.error(`Relaying a mention failed: ${errorCode(error)}`);
      const t = await i18n.forUser(user);
      await tell(t, t.inbox.relayFailed);
      return;
    }

    const t = await i18n.forUser(user);
    const lines = [
      relayed.started ? t.inbox.mention.ack : '',
      relayed.problems.length > 0 ? t.files.notReceived({ list: describeProblems(t, relayed.problems, 'person') }) : '',
    ].filter(Boolean);
    if (lines.length > 0) await tell(t, lines.join('\n\n'));
    await client.reactions.add({ channel, timestamp: ts, name: RECEIVED_EMOJI });
  });
}
