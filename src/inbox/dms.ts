import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { serialized } from '#src/lib/serialized.ts';
import { DAY } from '#src/lib/time.ts';
import { RECEIVED_EMOJI, missedDms } from './downtime.ts';
import type { Incoming, Relay } from './relay.ts';

interface Dm extends Incoming {
  channel: string;
  ts: string;
}

export interface Dms {
  /** Relays the DMs that arrived since `since` (ms) and weren't marked as received. Returns how many. */
  catchUp(client: WebClient, since: number): Promise<number>;
}

/**
 * DMs to the bot: each becomes, or continues, a conversation thread in the team channel, and is marked as received.
 * Those that arrived while the bot was down are relayed late, by catchUp.
 */
export function registerDms(app: App, { config, store, i18n, bot, notices }: Deps, relay: Relay): Dms {
  // DMs handled recently, so one caught up at start and also delivered live isn't relayed twice.
  const handled = new Set<string>();

  /** Relays a DM to its conversation thread and marks it as received. False if it was already handled. */
  async function handleDm(client: WebClient, dm: Dm): Promise<boolean> {
    const key = `${dm.channel}:${dm.ts}`;
    if (handled.has(key)) return false;
    handled.add(key);
    setTimeout(() => handled.delete(key), 10 * 60_000).unref();

    await serialized(dm.channel, async () => {
      const existing = store.conversations.latestDm(dm.channel, Date.now() - config.inboxIdleDays * DAY);
      const teamThreadTs = await relay(client, existing, () => i18n.team.inbox.thread.dmHeader({ user: dm.user }), dm);
      if (teamThreadTs) {
        store.conversations.create({ kind: 'dm', userId: dm.user, targetChannel: dm.channel, targetThreadTs: null, teamThreadTs });
        // Late DMs get one apology per person instead (see catchUp).
        if (!dm.lateTs) await acknowledge(client, dm.channel, dm.user, 'ack');
      }
    });
    await client.reactions.add({ channel: dm.channel, timestamp: dm.ts, name: RECEIVED_EMOJI });
    return true;
  }

  /** The bot's automatic reply in someone's DM, in their language, so it doesn't look like the team's. */
  async function acknowledge(client: WebClient, channel: string, user: string, which: 'ack' | 'lateAck') {
    const t = await i18n.forUser(user);
    await notices.toPerson(client, { channel, text: t.inbox.dm[which], username: t.notices.sender });
  }

  app.event('message', async ({ event, client }) => {
    if (event.channel_type !== 'im') return;
    if (event.subtype !== undefined && event.subtype !== 'file_share') return;
    if ('bot_id' in event && event.bot_id) return;
    const { channel, user, ts } = event;
    await handleDm(client, { channel, user, ts, text: event.text ?? '', blocks: event.blocks, files: event.files?.length ?? 0 });
  });

  return {
    async catchUp(client, since) {
      // A minute of overlap: DMs relayed just before going down already carry the received mark.
      const oldest = String((since - 60_000) / 1000);
      let recovered = 0;
      let cursor: string | undefined;
      do {
        const page = await client.conversations.list({ types: 'im', limit: 200, cursor });
        for (const im of page.channels ?? []) {
          if (!im.id || !im.user || im.user === 'USLACKBOT') continue;
          const { messages } = await client.conversations.history({ channel: im.id, oldest, limit: 200 });
          let relayed = 0;
          for (const m of missedDms(messages ?? [], bot.userId)) {
            const dm = {
              channel: im.id,
              user: m.user!,
              ts: m.ts!,
              text: m.text ?? '',
              blocks: m.blocks,
              files: m.files?.length ?? 0,
              lateTs: m.ts!,
            };
            if (await handleDm(client, dm)) relayed++;
          }
          if (relayed > 0) {
            await acknowledge(client, im.id, im.user, 'lateAck');
            recovered += relayed;
          }
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return recovered;
    },
  };
}
