import type { App, BlockAction, ButtonAction, GlobalShortcut, OverflowAction, ViewSubmitAction } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { serialized } from '#src/lib/serialized.ts';
import { ANON_SHORTCUT } from '#src/manifest/index.ts';
import { errorCode } from '#src/slack/errors.ts';
import { SEND_WAIT_MS, answerInTime, type Answer } from '#src/slack/forms.ts';
import { isBlank, richTextBlocks, richTextFromPlain } from '#src/slack/richtext.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import type { AnonymousThread } from './thread.ts';
import {
  INBOX_MAX_CONVERSATIONS,
  REPLY_BLOCK,
  anonModal,
  conversationView,
  deleteMessageView,
  editMessageView,
  endView,
  inboxView,
  lateChange,
  lateSending,
  noticeModal,
  type Page,
} from './views.ts';

/**
 * The author's side: the "Anonymous messages" window, opened from the Home tab, the command or the shortcut. From it
 * people start conversations, read the team's replies, write again, edit or delete their messages, end a conversation
 * and delete it.
 * Everything is a modal in the author's language: nothing is stored as a message in their Slack.
 */
export function registerWindow(app: App, deps: Deps, thread: AnonymousThread, sendWaitMs = SEND_WAIT_MS): void {
  const { config, store, anonOwner, bot, i18n } = deps;

  /** Why this person can't start a new anonymous conversation, if they can't. */
  function newConversationProblem(t: Strings, owner: string): string | undefined {
    if (store.anonymous.openCount(owner) >= config.anonMaxOpen) return t.anonymous.form.tooMany({ max: config.anonMaxOpen });
    return undefined;
  }

  function newConversationView(t: Strings, userId: string, text?: string): ModalView {
    const problem = newConversationProblem(t, anonOwner(userId));
    return problem
      ? noticeModal(t.anonymous.form.title, problem, t.common.close)
      : anonModal(t, text ? richTextFromPlain(text) : undefined, config.anonEncrypted ? config.anonReadableDays : undefined);
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

  /**
   * One conversation, with its messages decrypted, or, from before encryption, read back from the team channel. Marks
   * the team's replies as seen.
   */
  async function conversation(client: WebClient, t: Strings, c: AnonConversation, page: Page = {}): Promise<ModalView> {
    const messages = (await thread.read(client, c)).map((m) => ({
      author: m.author,
      ts: m.ts,
      body: m.body,
      isNew: m.author === 'team' && m.createdAt > c.seenAt,
      edited: m.editedAt !== null,
      deleted: m.deleted,
    }));
    store.anonymous.markSeen(c.id);
    return conversationView(t, { conversation: c, messages }, bot, config.anonClosedVisibleDays, Date.now(), page);
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

  // Registered even without the shortcut in the manifest, in case the app's settings still have it.
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

  app.view<ViewSubmitAction>('anon_message', async ({ ack, body, view, client }) => {
    const form = { ack, client, viewId: view.id, received: Date.now() };
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const owner = anonOwner(userId);
    const [message] = richTextBlocks([view.state.values.message?.message?.rich_text_value]);
    if (!message || isBlank(message)) {
      await ack({ response_action: 'errors', errors: { message: t.anonymous.form.empty } });
      return;
    }
    // Posted before answering, so the person only sees "sent" once it is in the team channel, unless Slack is slow.
    const answering = serialized(`anon:${owner}`, async (): Promise<Answer> => {
      const error = newConversationProblem(t, owner) ?? ((await thread.open(client, owner, message)) ? undefined : t.anonymous.sendFailed);
      if (error) return { response_action: 'errors', errors: { message: error } };
      return { response_action: 'update', view: noticeModal(t.anonymous.form.title, t.anonymous.form.sent, t.common.close) };
    });
    const answer = await answerInTime(form, answering, lateSending(t, t.anonymous.form.title, t.common.close), sendWaitMs);
    if (answer?.response_action === 'update') await refreshInbox(client, t, view.previous_view_id, userId);
  });

  // Reading a conversation, and writing again from its reply box.
  app.action<BlockAction<ButtonAction>>('anon_open', async ({ ack, body, action, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    const own = ownConversation(body.user.id, action.value);
    await client.views.push({
      trigger_id: body.trigger_id,
      view: own ? await conversation(client, t, own) : noticeModal(t.anonymous.window.title, t.anonymous.unavailable, t.common.close),
    });
    await refreshInbox(client, t, body.view?.id, body.user.id);
  });

  app.view<ViewSubmitAction>('anon_conversation', async ({ ack, body, view, client }) => {
    const form = { ack, client, viewId: view.id, received: Date.now() };
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const blockId = Object.keys(view.state.values).find((id) => id.startsWith(REPLY_BLOCK)) ?? REPLY_BLOCK;
    const [message] = richTextBlocks([view.state.values[blockId]?.reply?.rich_text_value]);
    if (!message || isBlank(message)) {
      await ack({ response_action: 'errors', errors: { [blockId]: t.anonymous.form.empty } });
      return;
    }
    const own = ownConversation(userId, view.private_metadata);
    const title = t.anonymous.conversation.title;
    const answering = (async (): Promise<Answer> => {
      const result =
        own?.closedAt === null ? await serialized(`anon:${own.owner}`, () => thread.followUp(client, own, message)) : 'gone';
      if (!own || result !== 'sent') {
        const error = result === 'failed' ? t.anonymous.sendFailed : t.anonymous.unavailable;
        return { response_action: 'errors', errors: { [blockId]: error } };
      }
      // It went: if the conversation can't be read back for now, the window only says so.
      const shown = await conversation(client, t, store.anonymous.byId(own.id)!).catch((error: unknown) => {
        app.logger.warn(`Couldn't read an anonymous conversation back: ${errorCode(error)}`);
        return noticeModal(title, t.common.sent, t.common.back);
      });
      return { response_action: 'update', view: shown };
    })();
    const answer = await answerInTime(form, answering, lateSending(t, title, t.common.back), sendWaitMs);
    if (answer?.response_action === 'update') await refreshInbox(client, t, view.previous_view_id, userId);
  });

  /** One of the author's own messages, if they may still change it: in their open conversation, and not deleted. */
  function ownMessage(userId: string, handle: string | undefined, ts: string | undefined) {
    const own = ownConversation(userId, handle);
    const message = ts ? store.anonymous.message(ts) : undefined;
    const theirs = message?.conversationId === own?.id && message?.author === 'person' && !message.deletedAt;
    return own && !own.closedAt && theirs ? own : undefined;
  }

  /** Which message one of the small windows over a conversation is about, and the conversation's reply box. */
  function aboutMessage(metadata: string): { handle?: string; ts?: string; reply?: string } {
    try {
      return JSON.parse(metadata) as { handle?: string; ts?: string; reply?: string };
    } catch {
      return {};
    }
  }

  /** The reply box of a window as it is now, so showing the window again keeps what is typed in it. */
  const replyBlockOf = (view: { state?: { values?: Record<string, unknown> } } | undefined) =>
    Object.keys(view?.state?.values ?? {}).find((id) => id.startsWith(REPLY_BLOCK));

  /** Back in the conversation, shown again with the change, and with whatever was typed in its reply box. */
  async function refreshConversation(client: WebClient, t: Strings, viewId: string | null | undefined, c: AnonConversation, replyBlock?: string) {
    if (!viewId) return;
    await client.views.update({ view_id: viewId, view: await conversation(client, t, store.anonymous.byId(c.id)!, { replyBlock }) });
  }

  // Reading back: earlier or later messages than the window shows.
  for (const way of ['earlier', 'later']) {
    app.action<BlockAction<ButtonAction>>(`anon_page_${way}`, async ({ ack, body, action, client }) => {
      await ack();
      const t = await i18n.forUser(body.user.id);
      const own = ownConversation(body.user.id, body.view?.private_metadata);
      if (!own || !body.view?.id) return;
      const page = { earlier: Number(action.value), replyBlock: replyBlockOf(body.view) };
      await client.views.update({ view_id: body.view.id, view: await conversation(client, t, own, page) });
    });
  }

  // Editing or deleting one of their own messages, from the menu beside it, while the conversation is open.
  app.action<BlockAction<OverflowAction>>('anon_own_message', async ({ ack, body, action, client }) => {
    await ack();
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const [what, ts] = action.selected_option.value.split(':');
    const handle = body.view?.private_metadata;
    const own = ownMessage(userId, handle, ts);
    if (!own || !ts) {
      await client.views.push({ trigger_id: body.trigger_id, view: noticeModal(t.anonymous.window.title, t.anonymous.unavailable, t.common.back) });
      return;
    }
    const c = t.anonymous.conversation;
    const metadata = JSON.stringify({ handle, ts, reply: replyBlockOf(body.view) });
    const current = await thread.readOne(client, own, ts);
    const view =
      what === 'edit'
        ? editMessageView(t, { callbackId: 'anon_own_edit', metadata, title: c.editTitle, label: t.anonymous.form.message }, current)
        : deleteMessageView(t, { callbackId: 'anon_own_delete', metadata, title: c.deleteTitle, text: c.deleteMessageConfirm, button: c.deleteMessage });
    await client.views.push({ trigger_id: body.trigger_id, view });
  });

  // Both change the message before answering, so the person is told if it didn't go through: until the thread shows
  // the change, a message whose text is there isn't changed.
  app.view<ViewSubmitAction>('anon_own_edit', async ({ ack, body, view, client }) => {
    const form = { ack, client, viewId: view.id, received: Date.now() };
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const { handle, ts, reply } = aboutMessage(view.private_metadata);
    const own = ownMessage(userId, handle, ts);
    const [message] = richTextBlocks([view.state.values.reply?.reply?.rich_text_value]);
    const error = !own ? t.anonymous.unavailable : !message || isBlank(message) ? t.anonymous.form.empty : undefined;
    if (error) {
      await ack({ response_action: 'errors', errors: { reply: error } });
      return;
    }
    const answering = thread.editMessage(client, own!, ts!, message!).then((changed): Answer =>
      changed ? undefined : { response_action: 'errors', errors: { reply: t.anonymous.conversation.changeFailed } },
    );
    const late = lateChange(t, t.anonymous.conversation.editTitle, t.common.back);
    if (!(await answerInTime(form, answering, late, sendWaitMs))) await refreshConversation(client, t, view.previous_view_id, own!, reply);
  });

  app.view<ViewSubmitAction>('anon_own_delete', async ({ ack, body, view, client }) => {
    const form = { ack, client, viewId: view.id, received: Date.now() };
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const { handle, ts, reply } = aboutMessage(view.private_metadata);
    const own = ownMessage(userId, handle, ts);
    const problem = (text: string): Answer => ({ response_action: 'update', view: noticeModal(t.anonymous.window.title, text, t.common.back) });
    if (!own) {
      await ack(problem(t.anonymous.unavailable));
      return;
    }
    const answering = thread.deleteMessage(client, own, ts!).then((deleted) => (deleted ? undefined : problem(t.anonymous.conversation.changeFailed)));
    const late = lateChange(t, t.anonymous.conversation.deleteTitle, t.common.back);
    if (!(await answerInTime(form, answering, late, sendWaitMs))) await refreshConversation(client, t, view.previous_view_id, own, reply);
  });

  // Ending a conversation: the author confirms first, and can also delete their messages from the team channel.
  app.action<BlockAction<ButtonAction>>('anon_end', async ({ ack, body, action, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    const own = ownConversation(body.user.id, action.value);
    if (!body.view?.id) return;
    await client.views.update({
      view_id: body.view.id,
      view: own && !own.closedAt ? endView(t, own.handle, own.encrypted) : noticeModal(t.anonymous.window.title, t.anonymous.unavailable, t.common.back),
    });
  });

  app.view('anon_end', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const own = ownConversation(userId, view.private_metadata);
    if (!own || !store.anonymous.close(own.id, 'person')) {
      await ack({ response_action: 'update', view: noticeModal(t.anonymous.window.title, t.anonymous.unavailable, t.common.back) });
      return;
    }
    const remove = (view.state.values.delete?.delete?.selected_options ?? []).length > 0;
    store.anonymous.purge(own.id);
    await ack({
      response_action: 'update',
      view: noticeModal(t.anonymous.conversation.title, remove ? t.anonymous.end.doneDeleted : t.anonymous.end.done, t.common.back),
    });
    await refreshInbox(client, t, view.previous_view_id, userId);
    if (remove) {
      await thread.remove(client, own, i18n.team.anonymous.team.deletedByPerson({ encrypted: own.encrypted ? 'yes' : 'no' }));
    } else {
      await thread.setStatus(client, own, { state: 'forgotten', note: i18n.team.anonymous.team.endedByPerson });
      await thread.note(client, own, i18n.team.anonymous.team.endedByPerson);
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
        view: noticeModal(t.anonymous.conversation.title, deletable ? t.anonymous.conversation.deleted : t.anonymous.unavailable, t.common.back),
      });
    }
    if (!deletable) return;
    store.anonymous.purge(deletable.id);
    await refreshInbox(client, t, body.view?.previous_view_id, body.user.id);
    await thread.remove(client, deletable, i18n.team.anonymous.team.deletedByPerson({ encrypted: deletable.encrypted ? 'yes' : 'no' }));
  });
}
