import type { App } from '@slack/bolt';
import type { RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { serialized } from '#src/lib/serialized.ts';
import { DAY } from '#src/lib/time.ts';
import { context, escapeMrkdwn, quoted } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { copiedNames, describeProblems, type AttachedFile, type Copies } from '#src/slack/files.ts';
import { plainText } from '#src/slack/richtext.ts';
import { RECEIVED_EMOJI, missedDms } from './downtime.ts';
import type { Incoming, Relay, Relayed } from './relay.ts';

interface Dm extends Incoming {
  channel: string;
  ts: string;
}

/** What someone wrote in the form: a message, files, or both. */
export interface Written {
  message?: RichTextBlock;
  files: readonly AttachedFile[];
}

export interface Dms {
  /** Relays the DMs that arrived since `since` (ms) and weren't marked as received. Returns how many. */
  catchUp(client: WebClient, since: number): Promise<number>;
  /**
   * A message written in the form, with its files, relayed as if it were a DM. A copy goes to the person's DM, where
   * the team's replies arrive, naming the files. Returns the files that couldn't be copied; throws if it couldn't reach
   * the team.
   */
  write(client: WebClient, user: string, written: Written): Promise<Copies['problems']>;
}


/**
 * DMs to the bot: each becomes, or continues, a conversation thread in the team channel, and is marked as received.
 * Those that arrived while the bot was down are relayed late, by catchUp.
 */
export function registerDms(app: App, { config, store, i18n, bot, notices }: Deps, relay: Relay): Dms {
  // DMs handled recently, so one caught up at start and also delivered live isn't relayed twice.
  const handled = new Set<string>();

  /**
   * Relays a DM to its conversation thread and marks it as received. False if it was already handled, or if it
   * couldn't reach the team, which the person is told so they can send it again.
   */
  async function handleDm(client: WebClient, dm: Dm): Promise<boolean> {
    const key = `${dm.channel}:${dm.ts}`;
    if (handled.has(key)) return false;
    handled.add(key);
    setTimeout(() => handled.delete(key), 10 * 60_000).unref();

    let relayed: Relayed;
    try {
      relayed = await toThread(client, dm);
    } catch (error) {
      app.logger.error(`Relaying a DM failed: ${errorCode(error)}`);
      await tell(client, dm.channel, dm.user, (t) => t.inbox.relayFailed);
      return false;
    }
    // Late DMs get one apology per person instead (see catchUp).
    if (relayed.started && !dm.lateTs) await tell(client, dm.channel, dm.user, (t) => t.inbox.dm.ack);
    if (relayed.problems.length > 0) {
      await tell(client, dm.channel, dm.user, (t) => t.files.notReceived({ list: describeProblems(t, relayed.problems, 'person') }));
    }
    await client.reactions.add({ channel: dm.channel, timestamp: dm.ts, name: RECEIVED_EMOJI });
    return true;
  }

  /** Relays a message to the person's conversation thread, or starts one, and records the thread it started. */
  async function toThread(client: WebClient, message: Incoming & { channel: string }): Promise<Relayed> {
    return serialized(message.channel, async () => {
      const existing = store.conversations.latestDm(message.channel, Date.now() - config.inboxIdleDays * DAY);
      const header = () => i18n.team.inbox.thread.dmHeader({ user: message.user });
      const relayed = await relay(client, existing, header, message);
      if (relayed.started) {
        const conversation = { kind: 'dm', userId: message.user, targetChannel: message.channel, targetThreadTs: null } as const;
        store.conversations.create({ ...conversation, teamThreadTs: relayed.started });
      }
      return relayed;
    });
  }

  /** The bot's automatic reply in someone's DM, in their language, so it doesn't look like the team's. */
  async function tell(client: WebClient, channel: string, user: string, text: (t: Strings) => string) {
    const t = await i18n.forUser(user);
    await notices.toPerson(client, { channel, text: text(t), username: t.notices.sender });
  }

  app.event('message', async ({ event, client }) => {
    if (event.channel_type !== 'im') return;
    if (event.subtype !== undefined && event.subtype !== 'file_share') return;
    if ('bot_id' in event && event.bot_id) return;
    const { channel, user, ts } = event;
    await handleDm(client, { channel, user, ts, text: event.text ?? '', blocks: event.blocks, files: event.files ?? [] });
  });

  return {
    async write(client, user, { message, files }) {
      const { channel } = await client.conversations.open({ users: user });
      if (!channel?.id) throw new Error('channel_not_found');
      const text = message ? plainText(message) : '';
      const blocks = message ? [message] : [];
      const { started, problems } = await toThread(client, { channel: channel.id, user, text, blocks, files });
      // The team has it now: a failed copy is only logged, so the person isn't told to send it again.
      try {
        const t = await i18n.forUser(user);
        const copied = quoted(t.inbox.dm.written, blocks);
        const names = copiedNames(files, problems).map(escapeMrkdwn);
        if (names.length > 0) copied.push(context(t.files.included({ count: names.length, list: names.join(', ') })));
        if (problems.length > 0) copied.push(context(t.files.notReceived({ list: describeProblems(t, problems, 'person') })));
        if (started) copied.push(context(t.inbox.dm.ack));
        const copy = { channel: channel.id, text: `${t.inbox.dm.written} ${text}`, username: t.notices.sender };
        await notices.toPerson(client, { ...copy, blocks: copied });
      } catch (error) {
        app.logger.warn(`Couldn't copy a written message to its DM: ${errorCode(error)}`);
      }
      return problems;
    },

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
              files: m.files ?? [],
              lateTs: m.ts!,
            };
            if (await handleDm(client, dm)) relayed++;
          }
          if (relayed > 0) {
            await tell(client, im.id, im.user, (t) => t.inbox.dm.lateAck);
            recovered += relayed;
          }
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return recovered;
    },
  };
}
