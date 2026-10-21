import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import { DAY } from '#src/lib/time.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import type { Anonymous } from './index.ts';
import type { AnonymousThread } from './thread.ts';

/**
 * The team's side, in the team channel: the buttons on each thread (end, and delete once the author is forgotten),
 * replies sent with the send emoji, replies withdrawn with the delete emoji, and the hourly cleanup.
 */
export function registerTeamSide(app: App, { config, store, team, i18n }: Deps, thread: AnonymousThread): Anonymous {
  const channel = config.teamChannelId;

  app.action<BlockAction<ButtonAction>>('anon_team_end', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    // The buttons carry no identifier: the conversation is found by the message they are on.
    const conversation = body.message ? store.anonymous.byTeamThread(body.message.ts) : undefined;
    if (!conversation?.teamThreadTs || !(await team.isMember(user))) return;
    const t = await i18n.forUser(user);
    if (!store.anonymous.close(conversation.id, 'team')) {
      return thread.ephemeral(client, conversation, user, t.anonAlreadyClosed);
    }
    const text = i18n.team.anonEndedBy(user);
    await thread.setStatus(client, conversation, { state: 'ended', note: text }, body.message);
    await thread.note(client, conversation, text);
  });

  app.action<BlockAction<ButtonAction>>('anon_team_delete', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const conversation = body.message ? store.anonymous.byTeamThread(body.message.ts) : undefined;
    if (!conversation?.teamThreadTs || !(await team.isMember(user))) return;
    const t = await i18n.forUser(user);
    if (conversation.owner) return thread.ephemeral(client, conversation, user, t.anonNotDeletable);
    await thread.remove(client, conversation);
    await client.chat.postEphemeral({ channel, user, text: t.anonDeletedByTeam });
  });

  return {
    async sendReply(client, conversation, ts, message, user, notify) {
      const t = await i18n.forUser(user);
      if (conversation.closedAt) return notify(t.anonReplyClosed);
      if (!store.anonymous.addMessage(ts, conversation.id, 'team', user)) return notify(t.alreadySent);
      store.anonymous.touch(conversation.id);
      await client.reactions.add({ channel, timestamp: ts, name: 'white_check_mark' });
      if (message.files?.length) await notify(t.filesNotSent);
    },

    async deleteReply(client, ts, user) {
      const message = store.anonymous.message(ts);
      if (message?.author !== 'team') return false;
      const threadTs = store.anonymous.byId(message.conversationId)?.teamThreadTs ?? ts;
      if (!store.anonymous.markMessageDeleted(ts)) {
        const t = await i18n.forUser(user);
        await client.chat.postEphemeral({ channel, user, thread_ts: threadTs, text: t.alreadyDeleted });
        return true;
      }
      await client.reactions.remove({ channel, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: i18n.team.anonReplyDeleted(user) });
      return true;
    },

    async cleanup(client) {
      const now = Date.now();
      // Conversations of another team channel (from before TEAM_CHANNEL_ID changed) expire and are forgotten too,
      // but their threads are left alone: they aren't in this channel.
      const here = (c: AnonConversation) => c.teamChannel === channel;
      for (const conversation of store.anonymous.expire(now - config.anonIdleDays * DAY, now).filter(here)) {
        const text = i18n.team.anonExpired(config.anonIdleDays);
        await thread.setStatus(client, conversation, { state: 'ended', note: text });
        await thread.note(client, conversation, text);
      }
      // The authors can't see these any more, so the team may now delete them.
      for (const conversation of store.anonymous.purgeClosed(now - config.anonClosedVisibleDays * DAY).filter(here)) {
        const ended =
          conversation.closedBy === 'expired' ? i18n.team.anonExpired(config.anonIdleDays) : i18n.team.anonEndedByTeam;
        await thread.setStatus(client, conversation, { state: 'forgotten', note: ended });
      }
    },
  };
}
