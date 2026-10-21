import type { App, BlockAction, ButtonAction, GlobalShortcut } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { serialized } from '#src/lib/serialized.ts';
import { ANON_SHORTCUT } from '#src/manifest/index.ts';
import { threadMessages } from '#src/slack/messages.ts';
import { isBlank, richTextBlocks, richTextFromPlain } from '#src/slack/richtext.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import type { AnonymousThread } from './thread.ts';
import {
  INBOX_MAX_CONVERSATIONS,
  REPLY_BLOCK,
  anonModal,
  conversationView,
  endView,
  inboxView,
  noticeModal,
} from './views.ts';

/**
 * The author's side: the "Anonymous messages" window, opened from the Home tab, the command or the shortcut. From it
 * people start conversations, read the team's replies, write again, end a conversation and delete their messages.
 * Everything is a modal in the author's language: nothing is stored as a message in their Slack.
 */
export function registerWindow(app: App, deps: Deps, thread: AnonymousThread): void {
  const { config, store, anonOwner, bot, i18n } = deps;

  /** Why this person can't start a new anonymous conversation, if they can't. */
  function newConversationProblem(t: Strings, owner: string): string | undefined {
    if (store.anonymous.openCount(owner) >= config.anonMaxOpen) return t.anonTooMany(config.anonMaxOpen);
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
    const items = store.anonymous.forOwner(anonOwner(userId), INBOX_MAX_CONVERSATIONS).map((conversation) => {
      const messages = store.anonymous.messages(conversation.id);
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
    const conversation = handle ? store.anonymous.byHandle(handle) : undefined;
    return conversation?.teamThreadTs && conversation.owner === anonOwner(userId) ? conversation : undefined;
  }

  /** One conversation, with its messages read back from the team channel. Marks the team's replies as seen. */
  async function conversation(client: WebClient, t: Strings, c: AnonConversation): Promise<ModalView> {
    const posted = await threadMessages(client, config.teamChannelId, c.teamThreadTs!);
    const messages = store.anonymous.messages(c.id).map((m) => {
      const found = posted.get(m.teamMessageTs);
      return {
        author: m.author,
        ts: m.teamMessageTs,
        body: (found && richTextBlocks(found.blocks)[0]) ?? null,
        isNew: m.author === 'team' && m.createdAt > c.seenAt,
      };
    });
    store.anonymous.markSeen(c.id);
    return conversationView(t, { conversation: c, messages }, bot, config.anonClosedVisibleDays);
  }

  /** Refreshes the "Anonymous messages" window under a modal opened from it. */
  async function refreshInbox(client: WebClient, t: Strings, inboxViewId: string | null | undefined, userId: string) {
    if (inboxViewId) await client.views.update({ view_id: inboxViewId, view: inbox(t, userId) });
  }

  async function openInbox(client: WebClient, triggerId: string, userId: string) {
    await client.views.open({ trigger_id: triggerId, view: inbox(await i18n.forUser(userId), userId) });
  }

  // Opening the window: the command (with text, it goes straight to a new conversation), the shortcut, the Home tab.
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

  app.action<BlockAction<ButtonAction>>('anon_inbox', async ({ ack, body, client }) => {
    await ack();
    await openInbox(client, body.trigger_id, body.user.id);
  });

  // Starting a conversation.
  app.action<BlockAction<ButtonAction>>('anon_new', async ({ ack, body, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    await client.views.push({ trigger_id: body.trigger_id, view: newConversationView(t, body.user.id) });
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
    const error = await serialized(`anon:${owner}`, async () => {
      const problem = newConversationProblem(t, owner);
      if (problem) return problem;
      return (await thread.open(client, owner, message)) ? undefined : t.anonSendFailed;
    });
    if (error) {
      await ack({ response_action: 'errors', errors: { message: error } });
      return;
    }
    await ack({ response_action: 'update', view: noticeModal(t.anonTitle, t.anonSent, t.anonClose) });
    await refreshInbox(client, t, view.previous_view_id, userId);
  });

  // Reading a conversation, and writing again from its reply box.
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
    const result =
      own?.closedAt === null ? await serialized(`anon:${own.owner}`, () => thread.followUp(client, own, message)) : 'gone';
    if (!own || result !== 'sent') {
      const error = result === 'failed' ? t.anonSendFailed : t.anonUnavailable;
      await ack({ response_action: 'errors', errors: { [blockId]: error } });
      return;
    }
    await ack({ response_action: 'update', view: await conversation(client, t, store.anonymous.byId(own.id)!) });
    await refreshInbox(client, t, view.previous_view_id, userId);
  });

  // Ending a conversation: the author confirms first, and can also delete their messages from the team channel.
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
    if (!own || !store.anonymous.close(own.id, 'person')) {
      await ack({ response_action: 'update', view: noticeModal(t.inboxTitle, t.anonUnavailable, t.convBack) });
      return;
    }
    const remove = (view.state.values.delete?.delete?.selected_options ?? []).length > 0;
    store.anonymous.purge(own.id);
    await ack({
      response_action: 'update',
      view: noticeModal(t.convTitle, remove ? t.endDoneDeleted : t.endDone, t.convBack),
    });
    await refreshInbox(client, t, view.previous_view_id, userId);
    if (remove) {
      await thread.remove(client, own, i18n.team.anonDeletedByPerson);
    } else {
      await thread.setStatus(client, own, { state: 'forgotten', note: i18n.team.anonEndedByPerson });
      await thread.note(client, own, i18n.team.anonEndedByPerson);
    }
  });

  // Deleting a conversation the team ended, or that ended by itself, while the author can still see it.
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
    store.anonymous.purge(deletable.id);
    await refreshInbox(client, t, body.view?.previous_view_id, body.user.id);
    await thread.remove(client, deletable, i18n.team.anonDeletedByPerson);
  });
}
