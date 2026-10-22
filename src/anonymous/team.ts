import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { DAY } from '#src/lib/time.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import type { Anonymous } from './index.ts';
import type { AnonymousThread } from './thread.ts';

/**
 * The team's side, in the team channel: the buttons on each thread (end, and delete once the author is forgotten),
 * replies sent with the send emoji, replies withdrawn with the delete emoji, and the hourly cleanup.
 */
export function registerTeamSide(app: App, { config, store, team, i18n, notices }: Deps, thread: AnonymousThread): Anonymous {
  const channel = config.teamChannelId;

  // What a button has to say goes in the channel, next to the thread's first message, where the buttons are.
  const tell = (client: WebClient, user: string, text: string) => notices.ephemeral(client, { user, text });

  /**
   * The conversation a button is on, if whoever clicked it may act on it; otherwise they are told why not. The buttons
   * carry no identifier: the conversation is found by the message they are on.
   */
  async function clicked(client: WebClient, user: string, message: { ts: string } | undefined) {
    const conversation = message ? store.anonymous.byTeamThread(message.ts) : undefined;
    const t = await i18n.forUser(user);
    const problem = !(await team.isMember(user))
      ? t.publish.teamOnly
      : !conversation?.teamThreadTs
        ? t.inbox.reply.notAConversation
        : undefined;
    if (problem) await tell(client, user, problem);
    return problem ? undefined : conversation;
  }

  app.action<BlockAction<ButtonAction>>('anon_team_end', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const conversation = await clicked(client, user, body.message);
    if (!conversation) return;
    const t = await i18n.forUser(user);
    if (!store.anonymous.close(conversation.id, 'team')) {
      return tell(client, user, t.anonymous.team.alreadyClosed);
    }
    const text = i18n.team.anonymous.team.endedBy({ user });
    await thread.setStatus(client, conversation, { state: 'ended', note: text }, body.message);
    await thread.note(client, conversation, text);
  });

  app.action<BlockAction<ButtonAction>>('anon_team_delete', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const conversation = await clicked(client, user, body.message);
    if (!conversation) return;
    const t = await i18n.forUser(user);
    if (conversation.owner) return tell(client, user, t.anonymous.team.notDeletable);
    await thread.remove(client, conversation);
    await tell(client, user, t.anonymous.team.deletedByTeam);
  });

  return {
    async sendReply(client, conversation, ts, message, user, notify) {
      const t = await i18n.forUser(user);
      if (conversation.closedAt) return notify(t.anonymous.team.replyClosed);
      if (!store.anonymous.addMessage(ts, conversation.id, 'team', user)) return notify(t.inbox.reply.alreadySent);
      store.anonymous.touch(conversation.id);
      await client.reactions.add({ channel, timestamp: ts, name: 'white_check_mark' });
      // For the whole team, in the thread: the person gets the text only.
      const threadTs = conversation.teamThreadTs!;
      if (message.files?.length) await notices.post(client, { text: i18n.team.files.anonymous, threadTs });
    },

    async deleteReply(client, ts, user) {
      const message = store.anonymous.message(ts);
      if (message?.author !== 'team') return false;
      const threadTs = store.anonymous.byId(message.conversationId)?.teamThreadTs ?? ts;
      if (!store.anonymous.markMessageDeleted(ts)) {
        const t = await i18n.forUser(user);
        await notices.ephemeral(client, { user, text: t.inbox.reply.alreadyDeleted, threadTs });
        return true;
      }
      await client.reactions.remove({ channel, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
      await notices.post(client, { text: i18n.team.anonymous.team.replyDeleted({ user }), threadTs });
      return true;
    },

    async cleanup(client) {
      const now = Date.now();
      // Conversations of another team channel (from before TEAM_CHANNEL_ID changed) expire and are forgotten too,
      // but their threads are left alone: they aren't in this channel.
      const here = (c: AnonConversation) => c.teamChannel === channel;
      for (const conversation of store.anonymous.expire(now - config.anonIdleDays * DAY, now).filter(here)) {
        const text = i18n.team.anonymous.team.expired({ days: config.anonIdleDays });
        await thread.setStatus(client, conversation, { state: 'ended', note: text });
        await thread.note(client, conversation, text);
      }
      // The authors can't see these any more, so the team may now delete them.
      for (const conversation of store.anonymous.purgeClosed(now - config.anonClosedVisibleDays * DAY).filter(here)) {
        const ended =
          conversation.closedBy === 'expired' ? i18n.team.anonymous.team.expired({ days: config.anonIdleDays }) : i18n.team.anonymous.team.endedByTeam;
        await thread.setStatus(client, conversation, { state: 'forgotten', note: ended });
      }
    },
  };
}
