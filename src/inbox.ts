import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Anonymous } from './anonymous.ts';
import { RECEIVED_EMOJI, missedDms } from './downtime.ts';
import { richTextBlocks } from './richtext.ts';
import {
  DAY,
  context,
  errorCode,
  fetchMessage,
  postInThread,
  quoted,
  serialized,
  slackDate,
  type Deps,
} from './slack.ts';
import type { Conversation } from './store.ts';

interface Incoming {
  user: string;
  text: string;
  blocks: readonly unknown[] | undefined;
  files: number;
  /** Set when relaying, late, a message sent while the bot was down. */
  lateTs?: string;
}

interface Dm extends Incoming {
  channel: string;
  ts: string;
}

export interface Inbox {
  /** Relays the DMs that arrived since `since` (ms) and weren't marked as received. Returns how many. */
  catchUp(client: WebClient, since: number): Promise<number>;
}

/**
 * The inbox: DMs to the bot and @bot mentions become threads in the team channel. A thread reply marked with the send
 * emoji goes back as the bot (or, in anonymous threads, to the author's Home tab); the delete emoji on any record of
 * something the bot sent deletes it.
 */
export function registerInbox(app: App, { config, store, i18n, bot }: Deps, anonymous: Anonymous): Inbox {
  const team = config.teamChannelId;
  // What the bot posts in the team channel is in the team's language; what only one person sees is in theirs.
  const teamStrings = i18n.team;

  /**
   * Posts the message in its conversation thread. Without one (or if its thread was deleted), starts a thread with
   * `header` and returns its ts.
   */
  async function relay(
    client: WebClient,
    existing: Conversation | undefined,
    header: () => Promise<string> | string,
    message: Incoming,
  ): Promise<string | undefined> {
    const body = (title: string) => {
      const blocks = quoted(title, richTextBlocks(message.blocks), message.text);
      if (message.files > 0) blocks.push(context(teamStrings.filesNotRelayed(message.files)));
      if (message.lateTs) blocks.push(context(teamStrings.lateRelay(slackDate(message.lateTs))));
      return { text: `${title} ${message.text}`, blocks };
    };

    if (existing) {
      const posted = await postInThread(client, {
        channel: team,
        thread_ts: existing.teamThreadTs,
        ...body(teamStrings.followUp(message.user)),
        unfurl_links: false,
      });
      if (posted) {
        store.touch(existing.id);
        return undefined;
      }
    }
    const { text, blocks } = body(await header());
    blocks.push(context(teamStrings.replyHint(config.sendEmoji)));
    const parent = await client.chat.postMessage({ channel: team, text, blocks, unfurl_links: false });
    return parent.ts;
  }

  // DMs handled recently, so one caught up at start and also delivered live isn't relayed twice.
  const handled = new Set<string>();

  /** Relays a DM to its conversation thread and marks it as received. False if it was already handled. */
  async function handleDm(client: WebClient, dm: Dm): Promise<boolean> {
    const key = `${dm.channel}:${dm.ts}`;
    if (handled.has(key)) return false;
    handled.add(key);
    setTimeout(() => handled.delete(key), 10 * 60_000).unref();

    await serialized(dm.channel, async () => {
      const existing = store.latestDm(dm.channel, Date.now() - config.inboxIdleDays * DAY);
      const teamThreadTs = await relay(client, existing, () => teamStrings.dmHeader(dm.user), dm);
      if (teamThreadTs) {
        store.createConversation({ kind: 'dm', userId: dm.user, targetChannel: dm.channel, targetThreadTs: null, teamThreadTs });
        // Late DMs get one apology per person instead (see catchUp).
        if (!dm.lateTs) await client.chat.postMessage({ channel: dm.channel, text: (await i18n.forUser(dm.user)).dmAck });
      }
    });
    await client.reactions.add({ channel: dm.channel, timestamp: dm.ts, name: RECEIVED_EMOJI });
    return true;
  }

  app.event('message', async ({ event, client }) => {
    if (event.channel_type !== 'im') return;
    if (event.subtype !== undefined && event.subtype !== 'file_share') return;
    if ('bot_id' in event && event.bot_id) return;
    const { channel, user, ts } = event;
    await handleDm(client, { channel, user, ts, text: event.text ?? '', blocks: event.blocks, files: event.files?.length ?? 0 });
  });

  app.event('app_mention', async ({ event, client }) => {
    const { channel, user, ts } = event;
    if (!user || event.bot_id || event.subtype) return;
    if (channel === team || channel.startsWith('D')) return;
    const threadTs = event.thread_ts ?? ts;
    const message = { user, text: event.text, blocks: event.blocks, files: event.files?.length ?? 0 };

    await serialized(`${channel}:${threadTs}`, async () => {
      const existing = store.mentionThread(channel, threadTs);
      const header = async () =>
        teamStrings.mentionHeader(user, channel, (await client.chat.getPermalink({ channel, message_ts: ts })).permalink ?? '');
      const teamThreadTs = await relay(client, existing, header, message);
      if (teamThreadTs) {
        store.createConversation({ kind: 'mention', userId: user, targetChannel: channel, targetThreadTs: threadTs, teamThreadTs });
      }
    });
  });

  app.event('reaction_added', async ({ event, client }) => {
    const { item } = event;
    if (item.type !== 'message' || item.channel !== team) return;
    if (event.reaction === config.sendEmoji) await sendReply(client, item.ts, event.user);
    else if (event.reaction === config.deleteEmoji) await deleteDelivery(client, item.ts, event.user);
  });

  async function sendReply(client: WebClient, ts: string, user: string) {
    const t = await i18n.forUser(user);
    const message = await fetchMessage(client, team, ts);
    const threadTs = message?.thread_ts;
    const notify = async (text: string) => {
      await client.chat.postEphemeral({ channel: team, user, thread_ts: threadTs, text });
    };

    if (!message || !threadTs || threadTs === ts) return notify(t.notInThread);
    if (message.bot_id) return notify(t.cannotSendBotMessage);
    const anon = store.anonByTeamThread(threadTs);
    const conversation = anon ? undefined : store.byTeamThread(threadTs);
    if (!anon && !conversation) return notify(t.notAConversation);
    const text = message.text ?? '';
    if (!text.trim()) return notify(t.emptyReply);
    if (anon) return anonymous.sendReply(client, anon, ts, message, user, notify);
    if (!conversation) return;
    if (!store.claimDelivery(ts, conversation.targetChannel, user)) return notify(t.alreadySent);

    let sentTs: string | undefined;
    try {
      const blocks = richTextBlocks(message.blocks);
      const sent = await client.chat.postMessage({
        channel: conversation.targetChannel,
        thread_ts: conversation.targetThreadTs ?? undefined,
        text,
        blocks: blocks.length > 0 ? blocks : undefined,
      });
      sentTs = sent.ts;
    } catch (error) {
      store.releaseDelivery(ts);
      return notify(t.sendFailed(errorCode(error)));
    }
    if (sentTs) store.completeDelivery(ts, sentTs);
    store.touch(conversation.id);
    await client.reactions.add({ channel: team, timestamp: ts, name: 'white_check_mark' });
    if (message.files?.length) await notify(t.filesNotSent);
  }

  async function deleteDelivery(client: WebClient, ts: string, user: string) {
    if (await anonymous.deleteReply(client, ts, user)) return;
    const delivery = store.delivery(ts);
    if (!delivery?.targetTs) return;
    const t = await i18n.forUser(user);
    const threadTs = (await fetchMessage(client, team, ts))?.thread_ts ?? ts;
    const notify = async (text: string) => {
      await client.chat.postEphemeral({ channel: team, user, thread_ts: threadTs, text });
    };
    if (delivery.deletedAt) return notify(t.alreadyDeleted);

    try {
      await client.chat.delete({ channel: delivery.targetChannel, ts: delivery.targetTs });
    } catch (error) {
      if (errorCode(error) !== 'message_not_found') return notify(t.deleteFailed(errorCode(error)));
    }
    store.markDeleted(ts);
    await client.reactions.remove({ channel: team, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
    await client.chat.postMessage({ channel: team, thread_ts: threadTs, text: teamStrings.deleted(user) });
  }

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
            await client.chat.postMessage({ channel: im.id, text: (await i18n.forUser(im.user)).lateAck });
            recovered += relayed;
          }
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return recovered;
    },
  };
}
