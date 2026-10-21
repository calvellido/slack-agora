import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { errorCode } from '#src/slack/errors.ts';
import { fetchMessage } from '#src/slack/messages.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';

/**
 * The team's reactions in the team channel: the send emoji on a thread reply sends it as the bot (anonymous threads are
 * handed to anonymous mode), and the delete emoji on the record of something the bot sent deletes it.
 */
export function registerReplies(app: App, { config, store, i18n }: Deps, anonymous: Anonymous): void {
  const team = config.teamChannelId;

  app.event('reaction_added', async ({ event, client }) => {
    const { item } = event;
    if (item.type !== 'message' || item.channel !== team) return;
    if (event.reaction === config.sendEmoji) await sendReply(client, item.ts, event.user);
    else if (event.reaction === config.deleteEmoji) await deleteDelivery(client, item.ts, event.user);
  });

  async function sendReply(client: WebClient, ts: string, user: string) {
    // Only `user` sees these notices, so in their language.
    const t = await i18n.forUser(user);
    const message = await fetchMessage(client, team, ts);
    const threadTs = message?.thread_ts;
    const notify = async (text: string) => {
      await client.chat.postEphemeral({ channel: team, user, thread_ts: threadTs, text });
    };

    if (!message || !threadTs || threadTs === ts) return notify(t.inbox.reply.notInThread);
    if (message.bot_id) return notify(t.inbox.reply.cannotSendBotMessage);
    const anon = store.anonymous.byTeamThread(threadTs);
    const conversation = anon ? undefined : store.conversations.byTeamThread(threadTs);
    if (!anon && !conversation) return notify(t.inbox.reply.notAConversation);
    const text = message.text ?? '';
    if (!text.trim()) return notify(t.inbox.reply.emptyReply);
    if (anon) return anonymous.sendReply(client, anon, ts, message, user, notify);
    if (!conversation) return;
    if (!store.deliveries.claim(ts, conversation.targetChannel, user)) return notify(t.inbox.reply.alreadySent);

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
      store.deliveries.release(ts);
      return notify(t.inbox.reply.sendFailed({ error: errorCode(error) }));
    }
    if (sentTs) store.deliveries.complete(ts, sentTs);
    store.conversations.touch(conversation.id);
    await client.reactions.add({ channel: team, timestamp: ts, name: 'white_check_mark' });
    if (message.files?.length) await notify(t.inbox.reply.filesNotSent);
  }

  async function deleteDelivery(client: WebClient, ts: string, user: string) {
    if (await anonymous.deleteReply(client, ts, user)) return;
    const delivery = store.deliveries.get(ts);
    if (!delivery?.targetTs) return;
    const t = await i18n.forUser(user);
    const threadTs = (await fetchMessage(client, team, ts))?.thread_ts ?? ts;
    const notify = async (text: string) => {
      await client.chat.postEphemeral({ channel: team, user, thread_ts: threadTs, text });
    };
    if (delivery.deletedAt) return notify(t.inbox.reply.alreadyDeleted);

    try {
      await client.chat.delete({ channel: delivery.targetChannel, ts: delivery.targetTs });
    } catch (error) {
      if (errorCode(error) !== 'message_not_found') return notify(t.inbox.reply.deleteFailed({ error: errorCode(error) }));
    }
    store.deliveries.markDeleted(ts);
    await client.reactions.remove({ channel: team, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
    await client.chat.postMessage({ channel: team, thread_ts: threadTs, text: i18n.team.inbox.reply.deleted({ user }) });
  }
}
