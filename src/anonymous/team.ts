import type { App, BlockAction, ButtonAction, OverflowAction, ViewSubmitAction } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import { errorCode } from '#src/slack/errors.ts';
import { SEND_WAIT_MS, answerInTime, type Answer } from '#src/slack/forms.ts';
import { isBlank, richTextBlocks } from '#src/slack/richtext.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import type { Anonymous } from './index.ts';
import type { AnonymousThread } from './thread.ts';
import {
  REPLY_BLOCK,
  deleteMessageView,
  editMessageView,
  lateChange,
  lateSending,
  noticeModal,
  teamConversationView,
  type Page,
} from './views.ts';

/**
 * The team's side, in the team channel: the buttons on each thread (open, end, and delete once the author is
 * forgotten), the window where the team reads and replies to an encrypted conversation, replies sent with the send
 * emoji to one from before encryption, replies withdrawn, and the hourly cleanup.
 */
export function registerTeamSide(
  app: App,
  { config, store, team, i18n, notices, bot }: Deps,
  thread: AnonymousThread,
  sendWaitMs = SEND_WAIT_MS,
): Anonymous {
  const channel = config.teamChannelId;

  // What a button has to say goes in the channel, next to the thread's first message, where the buttons are.
  const tell = (client: WebClient, user: string, text: string) => notices.ephemeral(client, { user, text });

  /**
   * The conversation a button is on, if whoever clicked it may act on it; otherwise they are told why not. The buttons
   * carry no identifier: the conversation is found by the message they are on.
   */
  async function clicked(client: WebClient, user: string, message: { ts: string; thread_ts?: string } | undefined) {
    // On the thread's first message, or, for the open button, on one of the person's later messages.
    const conversation = message ? store.anonymous.byTeamThread(message.thread_ts ?? message.ts) : undefined;
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
    await thread.setStatus(client, conversation, { state: 'ended', note: text });
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
    await tell(client, user, t.anonymous.team.deletedByTeam({ encrypted: conversation.encrypted ? 'yes' : 'no' }));
  });

  /** How an ended conversation ended, as its status says. */
  const ended = (c: AnonConversation) =>
    c.closedBy === 'expired'
      ? i18n.team.anonymous.team.expired({ days: config.anonIdleDays })
      : c.closedBy === 'person'
        ? i18n.team.anonymous.team.endedByPerson
        : i18n.team.anonymous.team.endedByTeam;

  const expiredText = (t: Strings) => t.anonymous.teamWindow.expired({ days: config.anonReadableDays });

  /** The team's window on an encrypted conversation, or why it can't be read any more. */
  async function teamWindow(client: WebClient, t: Strings, c: AnonConversation, page: Page = {}): Promise<ModalView> {
    if (!c.contentKey) return noticeModal(t.anonymous.conversation.title, expiredText(t), t.common.close);
    return teamConversationView(t, { conversation: c, messages: await thread.read(client, c) }, bot, Date.now(), page);
  }

  /** The conversation a window is about, if whoever acts in it is in the team and it can still be read. */
  async function windowConversation(user: string, teamThreadTs: string | undefined) {
    const conversation = teamThreadTs ? store.anonymous.byTeamThread(teamThreadTs) : undefined;
    const t = await i18n.forUser(user);
    if (!(await team.isMember(user))) return { t, problem: t.publish.teamOnly };
    if (!conversation) return { t, problem: t.anonymous.unavailable };
    if (!conversation.contentKey) return { t, problem: expiredText(t) };
    return { t, conversation };
  }

  /** The reply box of a window as it is now, so showing the window again keeps what is typed in it. */
  const replyBlockOf = (view: { state?: { values?: Record<string, unknown> } } | undefined) =>
    Object.keys(view?.state?.values ?? {}).find((id) => id.startsWith(REPLY_BLOCK));

  app.action<BlockAction<ButtonAction>>('anon_team_open', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const conversation = await clicked(client, user, body.message);
    if (!conversation) return;
    const t = await i18n.forUser(user);
    await client.views.open({ trigger_id: body.trigger_id, view: await teamWindow(client, t, conversation) });
  });

  // Reading back: earlier or later messages than the window shows.
  for (const way of ['earlier', 'later']) {
    app.action<BlockAction<ButtonAction>>(`anon_team_page_${way}`, async ({ ack, body, action, client }) => {
      await ack();
      const { t, conversation } = await windowConversation(body.user.id, body.view?.private_metadata);
      if (!conversation || !body.view?.id) return;
      const page = { earlier: Number(action.value), replyBlock: replyBlockOf(body.view) };
      await client.views.update({ view_id: body.view.id, view: await teamWindow(client, t, conversation, page) });
    });
  }

  // A reply from the window, encrypted like everything in the conversation.
  app.view<ViewSubmitAction>('anon_team_conversation', async ({ ack, body, view, client }) => {
    const form = { ack, client, viewId: view.id, received: Date.now() };
    const user = body.user.id;
    const blockId = Object.keys(view.state.values).find((id) => id.startsWith(REPLY_BLOCK)) ?? REPLY_BLOCK;
    const [message] = richTextBlocks([view.state.values[blockId]?.reply?.rich_text_value]);
    const { t, conversation, problem } = await windowConversation(user, view.private_metadata);
    const error = problem
      ?? (!message || isBlank(message) ? t.anonymous.form.empty : conversation!.closedAt ? t.anonymous.team.replyClosed : undefined);
    if (error) {
      await ack({ response_action: 'errors', errors: { [blockId]: error } });
      return;
    }
    const answering = thread.reply(client, conversation!, user, message!).then(async (result): Promise<Answer> => {
      if (result !== 'sent') {
        return { response_action: 'errors', errors: { [blockId]: result === 'failed' ? t.anonymous.sendFailed : t.anonymous.unavailable } };
      }
      return { response_action: 'update', view: await teamWindow(client, t, store.anonymous.byId(conversation!.id)!) };
    });
    await answerInTime(form, answering, lateSending(t, t.anonymous.conversation.title, t.common.close), sendWaitMs);
  });

  /** Which reply one of the small windows over the conversation is about, and the conversation's reply box. */
  function aboutReply(metadata: string): { ts?: string; reply?: string } {
    try {
      return JSON.parse(metadata) as { ts?: string; reply?: string };
    } catch {
      return {};
    }
  }

  /** The reply a small window is about, and its conversation, if whoever acts may still change it. */
  async function replyInWindow(user: string, ts: string | undefined) {
    const reply = ts ? store.anonymous.message(ts) : undefined;
    const conversation = reply ? store.anonymous.byId(reply.conversationId) : undefined;
    const found = await windowConversation(user, conversation?.teamThreadTs ?? undefined);
    if (found.problem) return found;
    if (reply?.author !== 'team') return { ...found, problem: found.t.anonymous.unavailable };
    if (reply.deletedAt) return { ...found, problem: found.t.inbox.reply.alreadyDeleted };
    return found;
  }

  // Editing or deleting a reply, which anyone in the team may do: each opens a small window over the conversation.
  app.action<BlockAction<OverflowAction>>('anon_team_reply', async ({ ack, body, action, client }) => {
    await ack();
    const [what, ts] = action.selected_option.value.split(':') as ['edit' | 'delete', string];
    const { t, conversation, problem } = await replyInWindow(body.user.id, ts);
    if (problem) {
      await client.views.push({ trigger_id: body.trigger_id, view: noticeModal(t.anonymous.conversation.title, problem, t.common.back) });
      return;
    }
    const w = t.anonymous.teamWindow;
    const metadata = JSON.stringify({ ts, reply: replyBlockOf(body.view) });
    const view =
      what === 'edit'
        ? editMessageView(t, { callbackId: 'anon_team_edit', metadata, title: w.editTitle, label: t.anonymous.conversation.reply }, await thread.readOne(client, conversation!, ts))
        : deleteMessageView(t, { callbackId: 'anon_team_withdraw', metadata, title: w.deleteTitle, text: w.deleteConfirm, button: w.delete });
    await client.views.push({ trigger_id: body.trigger_id, view });
  });

  /** Back in the conversation, shown again with the change, and with whatever was typed in its reply box. */
  async function refresh(client: WebClient, t: Strings, viewId: string | null | undefined, conversation: AnonConversation, replyBlock?: string) {
    if (!viewId) return;
    await client.views.update({ view_id: viewId, view: await teamWindow(client, t, store.anonymous.byId(conversation.id)!, { replyBlock }) });
  }

  app.view<ViewSubmitAction>('anon_team_edit', async ({ ack, body, view, client }) => {
    const form = { ack, client, viewId: view.id, received: Date.now() };
    const user = body.user.id;
    const { ts, reply } = aboutReply(view.private_metadata);
    const [message] = richTextBlocks([view.state.values.reply?.reply?.rich_text_value]);
    const { t, conversation, problem } = await replyInWindow(user, ts);
    const error = problem ?? (!message || isBlank(message) ? t.anonymous.form.empty : undefined);
    if (error) {
      await ack({ response_action: 'errors', errors: { reply: error } });
      return;
    }
    // Saved before answering, so a reply deleted meanwhile is told, not edited.
    const answering = thread.editReply(client, conversation!, ts!, message!, user).then((edited): Answer =>
      edited ? undefined : { response_action: 'errors', errors: { reply: t.inbox.reply.alreadyDeleted } },
    );
    const late = lateChange(t, t.anonymous.teamWindow.editTitle, t.common.back);
    if (!(await answerInTime(form, answering, late, sendWaitMs))) await refresh(client, t, view.previous_view_id, conversation!, reply);
  });

  app.view('anon_team_withdraw', async ({ ack, body, view, client }) => {
    const user = body.user.id;
    const { ts, reply } = aboutReply(view.private_metadata);
    const { t, conversation, problem } = await replyInWindow(user, ts);
    if (problem) {
      await ack({ response_action: 'update', view: noticeModal(t.anonymous.conversation.title, problem, t.common.back) });
      return;
    }
    await ack();
    await thread.withdrawReply(client, conversation!, ts!, user);
    await refresh(client, t, view.previous_view_id, conversation!, reply);
  });

  return {
    async sendReply(client, conversation, ts, message, user, notify) {
      const t = await i18n.forUser(user);
      // Its text would stay in the thread as written, so encrypted conversations are only answered from the window.
      if (conversation.encrypted) return notify(t.anonymous.team.replyFromWindow);
      if (conversation.closedAt) return notify(t.anonymous.team.replyClosed);
      if (!store.anonymous.addMessage(ts, conversation.id, 'team', user)) return notify(t.inbox.reply.alreadySent);
      store.anonymous.touch(conversation.id);
      // It was sent: a mark that fails, as when someone added it by hand first, changes nothing.
      await client.reactions.add({ channel, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
      // For the whole team, in the thread: the person gets the text only.
      const threadTs = conversation.teamThreadTs!;
      if (message.files?.length) await notices.post(client, { text: i18n.team.files.anonymous, threadTs });
    },

    async deleteReply(client, ts, user) {
      const message = store.anonymous.message(ts);
      const conversation = message?.author === 'team' ? store.anonymous.byId(message.conversationId) : undefined;
      if (!conversation) return false;
      if (!(await thread.withdrawReply(client, conversation, ts, user))) {
        const t = await i18n.forUser(user);
        await notices.ephemeral(client, { user, text: t.inbox.reply.alreadyDeleted, threadTs: conversation.teamThreadTs ?? ts });
      }
      return true;
    },

    async cleanup(client) {
      const now = Date.now();
      // Conversations of another team channel (from before TEAM_CHANNEL_ID changed) expire and are forgotten too,
      // but their threads are left alone: they aren't in this channel. Each thread on its own, so one Slack refuses
      // to change doesn't hold back the others, nor the steps after, which forget authors and destroy keys.
      const inEachThread = async (conversations: AnonConversation[], update: (c: AnonConversation) => Promise<void>) => {
        for (const conversation of conversations.filter((c) => c.teamChannel === channel)) {
          await update(conversation).catch((error: unknown) => {
            app.logger.error(`Cleanup couldn't update an anonymous thread: ${errorCode(error)}`);
          });
        }
      };
      await inEachThread(store.anonymous.expire(now - config.anonIdleDays * DAY, now), async (conversation) => {
        const text = i18n.team.anonymous.team.expired({ days: config.anonIdleDays });
        await thread.setStatus(client, conversation, { state: 'ended', note: text });
        await thread.note(client, conversation, text);
      });
      // The authors can't see these any more, so the team may now delete them.
      await inEachThread(store.anonymous.purgeClosed(now - config.anonClosedVisibleDays * DAY), async (conversation) => {
        await thread.setStatus(client, conversation, { state: 'forgotten', note: ended(conversation) });
      });
      // Long enough ended for their text to go from the database, by destroying their keys.
      await inEachThread(store.anonymous.destroyContent(now - config.anonReadableDays * DAY), async (conversation) => {
        const note = `${ended(conversation)} ${i18n.team.anonymous.team.textExpired({ days: config.anonReadableDays })}`;
        await thread.textDestroyed(client, conversation, { state: conversation.owner ? 'ended' : 'forgotten', note });
      });
    },
  };
}
