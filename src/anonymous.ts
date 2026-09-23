import type { App, BlockAction, ButtonAction, GlobalShortcut } from '@slack/bolt';
import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import {
  INBOX_MAX_CONVERSATIONS,
  REPLY_BLOCK,
  anonModal,
  conversationView,
  endView,
  inboxView,
  noticeModal,
  teamAnonStatus,
  withTeamAnonStatus,
  type TeamAnonState,
} from './anon-view.ts';
import { newHandle } from './anonymity.ts';
import { ANON_SHORTCUT } from './manifest.ts';
import { isBlank, plainText, richTextBlocks, richTextFromPlain } from './richtext.ts';
import {
  DAY,
  context,
  errorCode,
  fetchMessage,
  serialized,
  threadMessages,
  type Deps,
  type SlackMessage,
} from './slack.ts';
import type { Strings } from './i18n/index.ts';
import type { AnonConversation } from './store.ts';

/** What the inbox needs from anonymous mode to handle reactions in anonymous threads. */
export interface Anonymous {
  sendReply(
    client: WebClient,
    conversation: AnonConversation,
    ts: string,
    message: SlackMessage,
    user: string,
    notify: (text: string) => Promise<void>,
  ): Promise<void>;
  /** Handles a delete reaction on a reply to an anonymous conversation; false if it isn't one. */
  deleteReply(client: WebClient, ts: string, user: string): Promise<boolean>;
  /** Closes idle conversations and forgets the authors of conversations closed long enough ago. */
  cleanup(client: WebClient): Promise<void>;
}

/**
 * Anonymous mode. People write through modals, never a DM, so nothing stays in their message history, and their
 * conversations only show in the "Anonymous messages" window, never on the Home tab. Their messages land in the team
 * channel with no name or code. Only a keyed hash of the author is stored, until the conversation is purged.
 *
 * The windows are in the language of whoever opens them, and what the bot posts in the team channel in the team's.
 */
export function registerAnonymous(app: App, deps: Deps): Anonymous {
  const { config, store, team, anonOwner, bot, i18n } = deps;
  const teamChannel = config.teamChannelId;
  const teamStrings = i18n.team;

  /** Why this person can't start a new anonymous conversation, if they can't. */
  function newConversationProblem(t: Strings, owner: string): string | undefined {
    if (store.openAnonCount(owner) >= config.anonMaxOpen) return t.anonTooMany(config.anonMaxOpen);
    return undefined;
  }

  function newConversationView(t: Strings, userId: string, text?: string): ModalView {
    const problem = newConversationProblem(t, anonOwner(userId));
    return problem
      ? noticeModal(t.anonTitle, problem, t.anonClose)
      : anonModal(t, text ? richTextFromPlain(text) : undefined);
  }

  /** The "Anonymous messages" window. Built from the database alone, so it opens fast. */
  function inbox(t: Strings, userId: string): ModalView {
    const items = store.anonForOwner(anonOwner(userId), INBOX_MAX_CONVERSATIONS).map((conversation) => {
      const messages = store.anonMessages(conversation.id);
      return {
        conversation,
        lastTs: messages.at(-1)?.teamMessageTs ?? null,
        hasNew: messages.some((m) => m.author === 'team' && m.createdAt > conversation.seenAt),
      };
    });
    return inboxView(t, items, config.anonClosedVisibleDays);
  }

  /** The conversation behind `handle`, if this person wrote it and the bot hasn't forgotten them. */
  function ownConversation(userId: string, handle: string | undefined): AnonConversation | undefined {
    const conversation = handle ? store.anonByHandle(handle) : undefined;
    return conversation?.teamThreadTs && conversation.owner === anonOwner(userId) ? conversation : undefined;
  }

  /** One conversation, with its messages read back from the team channel. Marks the team's replies as seen. */
  async function conversation(client: WebClient, t: Strings, c: AnonConversation): Promise<ModalView> {
    const posted = await threadMessages(client, teamChannel, c.teamThreadTs!);
    const messages = store.anonMessages(c.id).map((m) => {
      const found = posted.get(m.teamMessageTs);
      return {
        author: m.author,
        ts: m.teamMessageTs,
        body: (found && richTextBlocks(found.blocks)[0]) ?? null,
        isNew: m.author === 'team' && m.createdAt > c.seenAt,
      };
    });
    store.markAnonSeen(c.id);
    return conversationView(t, { conversation: c, messages }, bot, config.anonClosedVisibleDays);
  }

  /** Refreshes the "Anonymous messages" window under a modal opened from it. */
  async function refreshInbox(client: WebClient, t: Strings, inboxViewId: string | null | undefined, userId: string) {
    if (inboxViewId) await client.views.update({ view_id: inboxViewId, view: inbox(t, userId) });
  }

  async function openInbox(client: WebClient, triggerId: string, userId: string) {
    await client.views.open({ trigger_id: triggerId, view: inbox(await i18n.forUser(userId), userId) });
  }

  app.command(config.anonCommand, async ({ ack, command, client }) => {
    await ack();
    const text = command.text.trim();
    if (!text) return openInbox(client, command.trigger_id, command.user_id);
    const t = await i18n.forUser(command.user_id);
    await client.views.open({ trigger_id: command.trigger_id, view: newConversationView(t, command.user_id, text) });
  });

  app.shortcut<GlobalShortcut>({ callback_id: ANON_SHORTCUT, type: 'shortcut' }, async ({ ack, shortcut, client }) => {
    await ack();
    await openInbox(client, shortcut.trigger_id, shortcut.user.id);
  });

  // The Home tab button.
  app.action<BlockAction<ButtonAction>>('anon_inbox', async ({ ack, body, client }) => {
    await ack();
    await openInbox(client, body.trigger_id, body.user.id);
  });

  app.action<BlockAction<ButtonAction>>('anon_new', async ({ ack, body, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    await client.views.push({ trigger_id: body.trigger_id, view: newConversationView(t, body.user.id) });
  });

  app.action<BlockAction<ButtonAction>>('anon_open', async ({ ack, body, action, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    const own = ownConversation(body.user.id, action.value);
    await client.views.push({
      trigger_id: body.trigger_id,
      view: own ? await conversation(client, t, own) : noticeModal(t.inboxTitle, t.anonUnavailable, t.anonClose),
    });
    await refreshInbox(client, t, body.view?.id, body.user.id);
  });

  app.view('anon_message', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const owner = anonOwner(userId);
    const [message] = richTextBlocks([view.state.values.message?.message?.rich_text_value]);
    if (!message || isBlank(message)) {
      await ack({ response_action: 'errors', errors: { message: t.anonEmpty } });
      return;
    }
    // Posted before acknowledging, so the person only sees "sent" once it is in the team channel.
    const result = await serialized(`anon:${owner}`, () => start(client, t, owner, message));
    if ('error' in result) {
      await ack({ response_action: 'errors', errors: { message: result.error } });
      return;
    }
    await ack({ response_action: 'update', view: noticeModal(t.anonTitle, t.anonSent, t.anonClose) });
    await refreshInbox(client, t, view.previous_view_id, userId);
  });

  // The reply box of an open conversation.
  app.view('anon_conversation', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const blockId = Object.keys(view.state.values).find((id) => id.startsWith(REPLY_BLOCK)) ?? REPLY_BLOCK;
    const [message] = richTextBlocks([view.state.values[blockId]?.reply?.rich_text_value]);
    if (!message || isBlank(message)) {
      await ack({ response_action: 'errors', errors: { [blockId]: t.anonEmpty } });
      return;
    }
    const own = ownConversation(userId, view.private_metadata);
    const result = own?.closedAt === null ? await serialized(`anon:${own.owner}`, () => writeAgain(client, own, message)) : 'gone';
    if (!own || result !== 'sent') {
      const error = result === 'failed' ? t.anonSendFailed : t.anonUnavailable;
      await ack({ response_action: 'errors', errors: { [blockId]: error } });
      return;
    }
    await ack({ response_action: 'update', view: await conversation(client, t, store.anonById(own.id)!) });
    await refreshInbox(client, t, view.previous_view_id, userId);
  });

  async function start(
    client: WebClient,
    t: Strings,
    owner: string,
    message: RichTextBlock,
  ): Promise<{ sent: true } | { error: string }> {
    const problem = newConversationProblem(t, owner);
    if (problem) return { error: problem };
    const conversation = store.reserveAnon(owner, newHandle);
    const header = teamStrings.anonHeader;
    let ts: string | undefined;
    try {
      const posted = await client.chat.postMessage({
        channel: teamChannel,
        text: `${header} ${plainText(message)}`,
        blocks: [context(header), message, ...teamAnonStatus(teamStrings, openStatus())],
        unfurl_links: false,
      });
      ts = posted.ts;
    } catch (error) {
      app.logger.error(`Could not post an anonymous message: ${errorCode(error)}`);
    }
    if (!ts) {
      store.dropAnon(conversation.id);
      return { error: t.anonSendFailed };
    }
    store.setAnonThread(conversation.id, ts);
    store.addAnonMessage(ts, conversation.id, 'person', null);
    return { sent: true };
  }

  /** Posts the author's message in their thread. */
  async function writeAgain(
    client: WebClient,
    conversation: AnonConversation,
    message: RichTextBlock,
  ): Promise<'sent' | 'failed'> {
    const header = teamStrings.anonFollowUp;
    let ts: string | undefined;
    try {
      const posted = await client.chat.postMessage({
        channel: teamChannel,
        thread_ts: conversation.teamThreadTs!,
        text: `${header} ${plainText(message)}`,
        blocks: [context(header), message],
        unfurl_links: false,
      });
      ts = posted.ts;
    } catch (error) {
      app.logger.error(`Could not post an anonymous message: ${errorCode(error)}`);
    }
    if (!ts) return 'failed';
    store.addAnonMessage(ts, conversation.id, 'person', null);
    store.touchAnon(conversation.id);
    return 'sent';
  }

  // The author ends their conversation: they confirm first, and can also delete their messages from the team channel.
  app.action<BlockAction<ButtonAction>>('anon_end', async ({ ack, body, action, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    const own = ownConversation(body.user.id, action.value);
    if (!body.view?.id) return;
    await client.views.update({
      view_id: body.view.id,
      view: own && !own.closedAt ? endView(t, own.handle) : noticeModal(t.inboxTitle, t.anonUnavailable, t.convBack),
    });
  });

  app.view('anon_end', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const own = ownConversation(userId, view.private_metadata);
    if (!own || !store.closeAnon(own.id, 'person')) {
      await ack({ response_action: 'update', view: noticeModal(t.inboxTitle, t.anonUnavailable, t.convBack) });
      return;
    }
    const remove = (view.state.values.delete?.delete?.selected_options ?? []).length > 0;
    store.purgeAnon(own.id);
    await ack({
      response_action: 'update',
      view: noticeModal(t.convTitle, remove ? t.endDoneDeleted : t.endDone, t.convBack),
    });
    await refreshInbox(client, t, view.previous_view_id, userId);
    if (remove) {
      await deleteThread(client, own, teamStrings.anonDeletedByPerson);
    } else {
      await setTeamStatus(client, own, { state: 'forgotten', note: teamStrings.anonEndedByPerson });
      await note(client, own, teamStrings.anonEndedByPerson);
    }
  });

  // The author deletes a conversation the team ended, or that ended by itself, while they can still see it.
  app.action<BlockAction<ButtonAction>>('anon_delete_own', async ({ ack, body, action, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    const own = ownConversation(body.user.id, action.value);
    const deletable = own?.closedAt ? own : undefined;
    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: noticeModal(t.convTitle, deletable ? t.convDeleted : t.anonUnavailable, t.convBack),
      });
    }
    if (!deletable) return;
    store.purgeAnon(deletable.id);
    await refreshInbox(client, t, body.view?.previous_view_id, body.user.id);
    await deleteThread(client, deletable, teamStrings.anonDeletedByPerson);
  });

  // The team's buttons on the thread's parent message.
  app.action<BlockAction<ButtonAction>>('anon_team_end', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const conversation = body.message ? store.anonByTeamThread(body.message.ts) : undefined;
    if (!conversation?.teamThreadTs || !(await team.isMember(user))) return;
    const t = await i18n.forUser(user);
    if (!store.closeAnon(conversation.id, 'team')) return ephemeral(client, conversation, user, t.anonAlreadyClosed);
    const text = teamStrings.anonEndedBy(user);
    await setTeamStatus(client, conversation, { state: 'ended', note: text }, body.message);
    await note(client, conversation, text);
  });

  app.action<BlockAction<ButtonAction>>('anon_team_delete', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const conversation = body.message ? store.anonByTeamThread(body.message.ts) : undefined;
    if (!conversation?.teamThreadTs || !(await team.isMember(user))) return;
    const t = await i18n.forUser(user);
    if (conversation.owner) return ephemeral(client, conversation, user, t.anonNotDeletable);
    await deleteThread(client, conversation);
    await client.chat.postEphemeral({ channel: teamChannel, user, text: t.anonDeletedByTeam });
  });

  /** Replaces the status at the end of the thread's parent message. */
  async function setTeamStatus(
    client: WebClient,
    conversation: AnonConversation,
    status: TeamAnonState,
    parent?: { ts: string; text?: string; blocks?: unknown[] },
  ) {
    const ts = conversation.teamThreadTs;
    if (!ts) return;
    const message = parent ?? (await fetchMessage(client, teamChannel, ts));
    if (!message?.blocks) return;
    await client.chat.update({
      channel: teamChannel,
      ts,
      text: message.text ?? '',
      blocks: withTeamAnonStatus(teamStrings, message.blocks, status),
    });
  }

  async function note(client: WebClient, conversation: AnonConversation, text: string) {
    if (conversation.teamThreadTs) {
      await client.chat.postMessage({ channel: teamChannel, thread_ts: conversation.teamThreadTs, text });
    }
  }

  async function ephemeral(client: WebClient, conversation: AnonConversation, user: string, text: string) {
    await client.chat.postEphemeral({ channel: teamChannel, user, thread_ts: conversation.teamThreadTs ?? undefined, text });
  }

  /**
   * Deletes everything the bot posted in the conversation's thread, the author's messages included, and then every record
   * of the conversation. Team members' own replies stay: only their authors can delete them.
   */
  async function deleteThread(client: WebClient, conversation: AnonConversation, leaveNote?: string) {
    const ts = conversation.teamThreadTs;
    if (!ts) return;
    const kept = leaveNote
      ? (await client.chat.postMessage({ channel: teamChannel, thread_ts: ts, text: leaveNote })).ts
      : undefined;
    const ours = [...(await threadMessages(client, teamChannel, ts)).values()]
      .filter((m) => m.ts && m.ts !== kept && m.bot_id === bot.botId)
      // The parent goes last: deleted while it still has replies, Slack leaves a "deleted message" placeholder.
      .sort((a, b) => Number(a.ts === ts) - Number(b.ts === ts));
    for (const message of ours) {
      try {
        await client.chat.delete({ channel: teamChannel, ts: message.ts! });
      } catch (error) {
        if (errorCode(error) !== 'message_not_found') app.logger.error(`Could not delete a message: ${errorCode(error)}`);
      }
    }
    store.deleteAnon(conversation.id);
  }

  function openStatus(): TeamAnonState {
    return { state: 'open', sendEmoji: config.sendEmoji, closedVisibleDays: config.anonClosedVisibleDays };
  }

  return {
    async sendReply(client, conversation, ts, message, user, notify) {
      const t = await i18n.forUser(user);
      if (conversation.closedAt) return notify(t.anonReplyClosed);
      if (!store.addAnonMessage(ts, conversation.id, 'team', user)) return notify(t.alreadySent);
      store.touchAnon(conversation.id);
      await client.reactions.add({ channel: teamChannel, timestamp: ts, name: 'white_check_mark' });
      if (message.files?.length) await notify(t.filesNotSent);
    },

    async deleteReply(client, ts, user) {
      const message = store.anonMessage(ts);
      if (message?.author !== 'team') return false;
      const threadTs = store.anonById(message.conversationId)?.teamThreadTs ?? ts;
      if (!store.markAnonMessageDeleted(ts)) {
        const t = await i18n.forUser(user);
        await client.chat.postEphemeral({ channel: teamChannel, user, thread_ts: threadTs, text: t.alreadyDeleted });
        return true;
      }
      await client.reactions.remove({ channel: teamChannel, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
      await client.chat.postMessage({ channel: teamChannel, thread_ts: threadTs, text: teamStrings.anonReplyDeleted(user) });
      return true;
    },

    async cleanup(client) {
      const now = Date.now();
      for (const conversation of store.expireAnon(now - config.anonIdleDays * DAY, now)) {
        const text = teamStrings.anonExpired(config.anonIdleDays);
        await setTeamStatus(client, conversation, { state: 'ended', note: text });
        await note(client, conversation, text);
      }
      // The authors can't see these any more, so the team may now delete them.
      for (const conversation of store.purgeClosedAnon(now - config.anonClosedVisibleDays * DAY)) {
        const ended =
          conversation.closedBy === 'expired' ? teamStrings.anonExpired(config.anonIdleDays) : teamStrings.anonEndedByTeam;
        await setTeamStatus(client, conversation, { state: 'forgotten', note: ended });
      }
    },
  };
}
