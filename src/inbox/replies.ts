import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { onceFor } from '#src/lib/once.ts';
import { serialized } from '#src/lib/serialized.ts';
import { DAY } from '#src/lib/time.ts';
import { messageBody } from '#src/slack/blocks.ts';
import { describeError, errorCode } from '#src/slack/errors.ts';
import { deleteCopies, describeProblems, uploadCopies, type AttachedFile } from '#src/slack/files.ts';
import { fetchMessage } from '#src/slack/messages.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';

/**
 * The team's reactions in the team channel: the send emoji on a thread reply sends it as the bot, with copies of its
 * files (anonymous threads are handed to anonymous mode), and the delete emoji on the record of something the bot sent
 * deletes it, files included. Editing a reply already sent edits what was sent too.
 */
export function registerReplies(app: App, { config, store, i18n, notices }: Deps, anonymous: Anonymous): void {
  const team = config.teamChannelId;

  // Sending a reply, editing it and deleting it happen one after another, so an edit made while the reply is still
  // being sent, its files uploading, waits for it instead of finding nothing sent yet.
  const inTurn = (ts: string, task: () => Promise<unknown>) => serialized(`reply:${ts}`, task);

  app.event('reaction_added', async ({ event, client }) => {
    const { item } = event;
    if (item.type !== 'message' || item.channel !== team) return;
    if (event.reaction === config.sendEmoji) await inTurn(item.ts, () => sendReply(client, item.ts, event.user));
    else if (event.reaction === config.deleteEmoji) await inTurn(item.ts, () => deleteDelivery(client, item.ts, event.user));
  });

  // Anonymous replies need nothing: the person's window shows them as they stand, from the channel or, encrypted, from
  // the team's window, edits included.
  const firstEdit = onceFor(DAY);
  app.event('message', async ({ event, client }) => {
    if (event.channel !== team || event.subtype !== 'message_changed') return;
    const after = event.message as { ts?: string; user?: string; text?: string; blocks?: unknown[]; thread_ts?: string; edited?: unknown };
    const before = (event.previous_message ?? {}) as { text?: string };
    if (!after.ts || !after.user || !after.edited || after.text === before.text) return;
    const { ts } = after;
    await inTurn(ts, () => sendEdit(client, { ...after, ts, user: after.user! }));
  });

  async function sendEdit(client: WebClient, after: { ts: string; user: string; text?: string; blocks?: unknown[]; thread_ts?: string }) {
    const delivery = store.deliveries.get(after.ts);
    if (!delivery || delivery.deletedAt || (!delivery.targetTs && delivery.fileIds.length === 0)) return;
    const { ts, user } = after;
    const t = await i18n.forUser(user);
    const notify = (text: string) => notices.ephemeral(client, { user, text, threadTs: after.thread_ts });

    // Copies of files can't be given text, and a message can't be left without any.
    if (!delivery.targetTs) return notify(t.inbox.reply.editFilesOnly({ sendEmoji: config.sendEmoji }));
    const text = after.text ?? '';
    if (!text.trim()) return notify(t.inbox.reply.editEmpty({ deleteEmoji: config.deleteEmoji }));
    try {
      // Always with blocks: without them, Slack would keep showing the ones sent before.
      const blocks = messageBody(richTextBlocks(after.blocks), text);
      await client.chat.update({ channel: delivery.targetChannel, ts: delivery.targetTs, text, blocks });
    } catch (error) {
      return notify(t.inbox.reply.editFailed({ reason: describeError(t, error) }));
    }
    // Once per reply: the thread's hint already says edits are sent.
    if (firstEdit(ts)) await notify(t.inbox.reply.editSent);
  }

  async function sendReply(client: WebClient, ts: string, user: string) {
    // Only `user` sees these notices, so in their language.
    const t = await i18n.forUser(user);
    const message = await fetchMessage(client, team, ts);
    const threadTs = message?.thread_ts;
    const notify = (text: string) => notices.ephemeral(client, { user, text, threadTs });

    // In an encrypted anonymous conversation, any message: its text would stay in the thread as written.
    if (message && store.anonymous.byTeamThread(threadTs ?? ts)?.encrypted) return notify(t.anonymous.team.replyFromWindow);
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
        return notify(t.inbox.reply.sendFailed({ reason: describeError(t, error) }));
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
    // It was sent: a mark that fails, as when someone added it by hand first, changes nothing.
    await client.reactions.add({ channel: team, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
  }

  async function deleteDelivery(client: WebClient, ts: string, user: string) {
    if (await anonymous.deleteReply(client, ts, user)) return;
    const t = await i18n.forUser(user);
    const threadTs = (await fetchMessage(client, team, ts))?.thread_ts ?? ts;
    const notify = (text: string) => notices.ephemeral(client, { user, text, threadTs });
    const delivery = store.deliveries.get(ts);
    if (!delivery || (!delivery.targetTs && delivery.fileIds.length === 0)) {
      // In an encrypted anonymous thread, the emoji only withdraws a reply, which anonymous mode handled above.
      if (store.anonymous.byTeamThread(threadTs)?.encrypted) {
        return notify(t.anonymous.team.nothingToDelete({ deleteEmoji: config.deleteEmoji }));
      }
      return notify(t.inbox.reply.nothingToDelete({ sendEmoji: config.sendEmoji, deleteEmoji: config.deleteEmoji }));
    }
    if (delivery.deletedAt) return notify(t.inbox.reply.alreadyDeleted);

    try {
      if (delivery.targetTs) await client.chat.delete({ channel: delivery.targetChannel, ts: delivery.targetTs });
    } catch (error) {
      if (errorCode(error) !== 'message_not_found') return notify(t.inbox.reply.deleteFailed({ reason: describeError(t, error) }));
    }
    // Deleting the copies also removes the messages that held only them.
    try {
      await deleteCopies(client, delivery.fileIds);
    } catch (error) {
      return notify(t.inbox.reply.deleteFailed({ reason: describeError(t, error) }));
    }
    store.deliveries.markDeleted(ts);
    await client.reactions.remove({ channel: team, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
    await notices.post(client, { text: i18n.team.inbox.reply.deleted({ user }), threadTs });
  }
}
