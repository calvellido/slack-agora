import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { errorCode } from '#src/slack/errors.ts';
import { deleteCopies, describeProblems, uploadCopies, type AttachedFile } from '#src/slack/files.ts';
import { fetchMessage } from '#src/slack/messages.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';

/**
 * The team's reactions in the team channel: the send emoji on a thread reply sends it as the bot, with copies of its
 * files (anonymous threads are handed to anonymous mode), and the delete emoji on the record of something the bot sent
 * deletes it, files included.
 */
export function registerReplies(app: App, { config, store, i18n, notices }: Deps, anonymous: Anonymous): void {
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
    const notify = (text: string) => notices.ephemeral(client, { user, text, threadTs });

    if (!message || !threadTs || threadTs === ts) return notify(t.inbox.reply.notInThread);
    if (message.bot_id) return notify(t.inbox.reply.cannotSendBotMessage);
    const anon = store.anonymous.byTeamThread(threadTs);
    const conversation = anon ? undefined : store.conversations.byTeamThread(threadTs);
    if (!anon && !conversation) return notify(t.inbox.reply.notAConversation);
    const text = message.text ?? '';
    const files = (message.files ?? []) as AttachedFile[];
    // Anonymous replies send the text only, so they need some.
    if (!text.trim() && (anon || files.length === 0)) return notify(t.inbox.reply.emptyReply);
    if (anon) return anonymous.sendReply(client, anon, ts, message, user, notify);
    if (!conversation) return;
    if (!store.deliveries.claim(ts, conversation.targetChannel, user)) return notify(t.inbox.reply.alreadySent);

    const where = { channel: conversation.targetChannel, threadTs: conversation.targetThreadTs ?? undefined };
    let sentTs: string | undefined;
    if (text.trim()) {
      try {
        const blocks = richTextBlocks(message.blocks);
        const sent = await client.chat.postMessage({
          channel: where.channel,
          thread_ts: where.threadTs,
          text,
          blocks: blocks.length > 0 ? blocks : undefined,
        });
        sentTs = sent.ts;
      } catch (error) {
        store.deliveries.release(ts);
        return notify(t.inbox.reply.sendFailed({ error: errorCode(error) }));
      }
    }
    // As the bot itself, which is the team's voice, so uploaded as they are.
    const copies = files.length > 0 ? await uploadCopies(client, files, where) : { fileIds: [], problems: [] };
    if (copies.problems.length > 0) {
      const list = describeProblems(i18n.team, copies.problems, 'team');
      await notices.post(client, { text: i18n.team.files.notSent({ list }), threadTs });
    }
    if (!sentTs && copies.fileIds.length === 0) return store.deliveries.release(ts);
    store.deliveries.complete(ts, sentTs ?? null, copies.fileIds);
    store.conversations.touch(conversation.id);
    await client.reactions.add({ channel: team, timestamp: ts, name: 'white_check_mark' });
  }

  async function deleteDelivery(client: WebClient, ts: string, user: string) {
    if (await anonymous.deleteReply(client, ts, user)) return;
    const delivery = store.deliveries.get(ts);
    if (!delivery || (!delivery.targetTs && delivery.fileIds.length === 0)) return;
    const t = await i18n.forUser(user);
    const threadTs = (await fetchMessage(client, team, ts))?.thread_ts ?? ts;
    const notify = (text: string) => notices.ephemeral(client, { user, text, threadTs });
    if (delivery.deletedAt) return notify(t.inbox.reply.alreadyDeleted);

    try {
      if (delivery.targetTs) await client.chat.delete({ channel: delivery.targetChannel, ts: delivery.targetTs });
    } catch (error) {
      if (errorCode(error) !== 'message_not_found') return notify(t.inbox.reply.deleteFailed({ error: errorCode(error) }));
    }
    // Deleting the copies also removes the messages that held only them.
    try {
      await deleteCopies(client, delivery.fileIds);
    } catch (error) {
      return notify(t.inbox.reply.deleteFailed({ error: errorCode(error) }));
    }
    store.deliveries.markDeleted(ts);
    await client.reactions.remove({ channel: team, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
    await notices.post(client, { text: i18n.team.inbox.reply.deleted({ user }), threadTs });
  }
}
