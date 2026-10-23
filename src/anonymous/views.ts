import type { ActionsBlock, Button, KnownBlock, ModalView, RichTextBlock } from '@slack/types';
import type { Strings } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import { context, modalTitle, slackDate, spacer } from '#src/slack/blocks.ts';
import type { AnonConversation, AnonMessage } from '#src/storage/index.ts';

// Views of anonymous mode, in the language of `t`. Nothing here may contain the author's identity. They are all modals, never the Home tab:
// Slack shows the last published Home tab whenever the bot is opened, so anything there could be seen over a shoulder.

const plain = (text: string) => ({ type: 'plain_text' as const, text });
const mrkdwn = (text: string) => ({ type: 'mrkdwn' as const, text });

/** The form to start an anonymous conversation; `readableDays` when it will be encrypted, which it then says. */
export function anonModal(t: Strings, message?: RichTextBlock, readableDays?: number): ModalView {
  const privacy = [t.anonymous.form.privacy, ...(readableDays ? [t.anonymous.form.encrypted({ days: readableDays })] : [])];
  return {
    type: 'modal',
    callback_id: 'anon_message',
    title: plain(t.anonymous.form.title),
    submit: plain(t.anonymous.form.submit),
    close: plain(t.common.cancel),
    blocks: [
      { type: 'section', text: mrkdwn(t.anonymous.form.intro) },
      spacer(),
      {
        type: 'input',
        block_id: 'message',
        label: plain(t.anonymous.form.message),
        element: { type: 'rich_text_input', action_id: 'message', initial_value: message, focus_on_load: true },
      },
      spacer(),
      context(privacy.join('\n')),
    ],
  };
}

/** A modal that only says something, e.g. why a new conversation can't be started. */
export function noticeModal(title: string, text: string, close: string): ModalView {
  return {
    type: 'modal',
    title: modalTitle(title),
    close: plain(close),
    blocks: [{ type: 'section', text: mrkdwn(text) }],
  };
}

export interface InboxItem {
  conversation: AnonConversation;
  /** ts of the latest message, if any is left. */
  lastTs: string | null;
  /** The team replied since the author last opened it. */
  hasNew: boolean;
}

export const INBOX_MAX_CONVERSATIONS = 10;

/** "Mensajes anónimos": the viewer's conversations, or general information if they have none. */
export function inboxView(t: Strings, items: InboxItem[], closedVisibleDays: number, now = Date.now()): ModalView {
  const blocks: KnownBlock[] = [
    { type: 'section', text: mrkdwn(t.anonymous.window.intro) },
    {
      type: 'actions',
      elements: [{ type: 'button', action_id: 'anon_new', style: 'primary', text: plain(t.anonymous.window.new) }],
    },
  ];
  if (items.length === 0) {
    blocks.push(context(t.anonymous.window.empty));
  } else {
    blocks.push(spacer(), { type: 'divider' }, { type: 'section', text: mrkdwn(t.anonymous.window.conversations) });
    for (const [i, { conversation, lastTs, hasNew }] of items.slice(0, INBOX_MAX_CONVERSATIONS).entries()) {
      if (i > 0) blocks.push(spacer());
      const title = [t.anonymous.conversation.name, hasNew ? t.anonymous.window.newReply : ''].filter(Boolean).join('  ');
      const details = [
        conversation.teamThreadTs ? t.anonymous.window.started({ date: slackDate(conversation.teamThreadTs) }) : '',
        lastTs && lastTs !== conversation.teamThreadTs ? t.anonymous.window.last({ date: slackDate(lastTs) }) : '',
        closedStatus(t, conversation, closedVisibleDays, now),
      ]
        .filter(Boolean)
        .join('\n');
      blocks.push({
        type: 'section',
        text: mrkdwn([title, details].filter(Boolean).join('\n')),
        accessory: { type: 'button', action_id: 'anon_open', value: conversation.handle, text: plain(t.anonymous.window.open) },
      });
    }
  }
  blocks.push(spacer(), { type: 'divider' }, context(t.anonymous.form.privacy));
  return { type: 'modal', callback_id: 'anon_inbox', title: modalTitle(t.anonymous.window.title), close: plain(t.common.close), blocks };
}

export interface ConversationView {
  conversation: AnonConversation;
  /** Oldest first. */
  messages: {
    author: AnonMessage['author'];
    ts: string;
    /** Null when it is no longer available: gone from the team channel, or its key destroyed. */
    body: RichTextBlock | null;
    isNew: boolean;
    /** A reply the team edited after sending it. */
    edited?: boolean;
    /** Deleted after it was sent, by the author or the team: shown in its place, without its text. */
    deleted?: boolean;
  }[];
}

/** In place of a message deleted after it was sent, as a window shows it. */
const deletedLine = (text: string): KnownBlock => ({ type: 'section', text: mrkdwn(`_${text}_`) });

/** Who answers in the window: the bot, as it appears in Slack. */
export interface Speaker {
  name: string;
  avatar?: string;
}

/** Most messages shown, to stay below a modal's 100 blocks: each can take three, with its author and a space. */
export const CONVERSATION_MAX_MESSAGES = 30;

/** Messages from the same side this close together go under one header, as in a Slack channel. */
const GROUP_SECONDS = 10 * 60;

/**
 * Block IDs of the reply box start with this; the rest changes on every render so the box comes back empty after
 * sending, and stays the same when the window is shown again for anything else, so a draft in it survives.
 */
export const REPLY_BLOCK = 'reply-';

/** Which messages a window shows: `earlier` of the latest ones skipped, to read back; and the reply box to keep. */
export interface Page {
  earlier?: number;
  replyBlock?: string;
}

/**
 * The messages a page shows, at most CONVERSATION_MAX_MESSAGES, and the buttons to read earlier or later ones, whose
 * values say how many of the latest messages to skip. `actionId` is the windows' own.
 */
function paged<M>(t: Strings, messages: M[], earlier: number, actionId: string) {
  const end = Math.max(0, messages.length - earlier);
  const start = Math.max(0, end - CONVERSATION_MAX_MESSAGES);
  const buttons = [
    ...(start > 0
      ? [{ type: 'button' as const, action_id: `${actionId}_earlier`, value: String(messages.length - start), text: plain(t.anonymous.conversation.earlier({ count: start })) }]
      : []),
    ...(end < messages.length
      ? [{ type: 'button' as const, action_id: `${actionId}_later`, value: String(Math.max(0, earlier - CONVERSATION_MAX_MESSAGES)), text: plain(t.anonymous.conversation.later) }]
      : []),
  ];
  const nav: KnownBlock[] = buttons.length > 0 ? [{ type: 'actions', elements: buttons }] : [];
  return { shown: messages.slice(start, end), nav };
}

/** Whether a message goes under the previous one's line: same side, close together, and neither of them edited. */
function together<M extends { author: AnonMessage['author']; ts: string }>(message: M, previous: M | undefined, edited: (m: M) => boolean) {
  if (!previous || previous.author !== message.author || edited(message) || edited(previous)) return false;
  return Number(message.ts) - Number(previous.ts) < GROUP_SECONDS;
}

/** One conversation as a chat, with a reply box while it is open. */
export function conversationView(
  t: Strings,
  { conversation, messages }: ConversationView,
  bot: Speaker,
  closedVisibleDays: number,
  now = Date.now(),
  page: Page = {},
): ModalView {
  const open = !conversation.closedAt;
  const { shown, nav } = paged(t, messages, page.earlier ?? 0, 'anon_page');
  const blocks: KnownBlock[] = [];

  const status = closedStatus(t, conversation, closedVisibleDays, now);
  if (status) blocks.push({ type: 'section', text: mrkdwn(status) }, { type: 'divider' });
  blocks.push(...nav);

  const groups: (typeof shown)[] = [];
  for (const message of shown) {
    const group = groups.at(-1);
    // An edited message goes under a line of its own, which says so, and so does each of the author's own while the
    // conversation is open, with the menu to edit or delete it.
    const ownLine = open && message.author === 'person';
    if (group && !ownLine && together(message, group.at(-1), (m) => Boolean(m.edited || m.deleted))) {
      group.push(message);
    } else {
      groups.push([message]);
    }
  }
  for (const [i, group] of groups.entries()) {
    const first = group[0]!;
    if (i > 0) blocks.push(spacer());
    // A deleted message can't be changed any more, and its edits no longer matter.
    const menu = open && first.author === 'person' && !first.deleted ? first.ts : undefined;
    blocks.push(speakerLine(t, first.author, first.ts, group.some((m) => m.isNew), bot, first.edited && !first.deleted, menu));
    for (const message of group) {
      const gone = message.author === 'person' ? t.anonymous.conversation.deletedMessage : t.anonymous.conversation.deletedReply;
      blocks.push(message.deleted ? deletedLine(gone) : (message.body ?? { type: 'section', text: mrkdwn(t.anonymous.conversation.unavailable) }));
    }
  }

  blocks.push(spacer());
  if (open) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'input',
        block_id: page.replyBlock ?? `${REPLY_BLOCK}${now}`,
        label: plain(t.anonymous.conversation.reply),
        element: { type: 'rich_text_input', action_id: 'reply' },
      },
      { type: 'actions', elements: [{ type: 'button', action_id: 'anon_end', value: conversation.handle, text: plain(t.anonymous.conversation.end) }] },
    );
  } else {
    blocks.push({ type: 'divider' }, deleteOwnButton(t, conversation.handle));
  }

  return {
    type: 'modal',
    callback_id: 'anon_conversation',
    private_metadata: conversation.handle,
    title: modalTitle(t.anonymous.conversation.title),
    close: plain(t.common.back),
    ...(open ? { submit: plain(t.anonymous.conversation.send) } : {}),
    blocks,
  };
}

/** `menu`: the author's own message, with the menu to edit or delete it. */
function speakerLine(
  t: Strings,
  author: AnonMessage['author'],
  ts: string,
  isNew: boolean,
  bot: Speaker,
  edited = false,
  menu?: string,
): KnownBlock {
  const mark = author === 'person' ? t.anonymous.conversation.editedMessage : t.anonymous.conversation.editedReply;
  const when = [slackDate(ts), edited ? `· _${mark}_` : '', isNew ? t.anonymous.conversation.new : ''].filter(Boolean).join(' ');
  if (author === 'person' && menu) {
    const options = { edit: t.anonymous.conversation.editMessage, delete: t.anonymous.conversation.deleteMessage };
    return { type: 'section', text: mrkdwn(`${t.anonymous.conversation.you}   ${when}`), accessory: messageMenu('anon_own_message', menu, options) };
  }
  if (author === 'person') return context(`${t.anonymous.conversation.you}   ${when}`);
  return {
    type: 'context',
    elements: [
      ...(bot.avatar ? [{ type: 'image' as const, image_url: bot.avatar, alt_text: bot.name }] : []),
      mrkdwn(`*${bot.name}*   ${when}`),
    ],
  };
}

function deleteOwnButton(t: Strings, handle: string): ActionsBlock {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'anon_delete_own',
        value: handle,
        style: 'danger',
        text: plain(t.anonymous.conversation.delete),
        confirm: { ...confirm(t, t.anonymous.conversation.deleteConfirmTitle, t.anonymous.conversation.deleteConfirm, t.anonymous.conversation.deleteConfirmButton), style: 'danger' },
      },
    ],
  };
}

/**
 * Confirms ending a conversation, optionally deleting the author's messages from the team channel, and, when it is
 * `encrypted`, the team's replies, which are the bot's too.
 */
export function endView(t: Strings, handle: string, encrypted = false): ModalView {
  return {
    type: 'modal',
    callback_id: 'anon_end',
    private_metadata: handle,
    title: modalTitle(t.anonymous.conversation.title),
    submit: plain(t.anonymous.end.submit),
    close: plain(t.common.cancel),
    blocks: [
      { type: 'section', text: mrkdwn(t.anonymous.end.intro) },
      spacer(),
      {
        type: 'input',
        block_id: 'delete',
        optional: true,
        label: plain(t.anonymous.end.deleteLabel),
        element: {
          type: 'checkboxes',
          action_id: 'delete',
          options: [{ text: plain(t.anonymous.end.deleteOption), value: 'delete' }],
        },
      },
      context(t.anonymous.end.deleteHint({ encrypted: encrypted ? 'yes' : 'no' })),
    ],
  };
}

function closedStatus(t: Strings, c: AnonConversation, closedVisibleDays: number, now: number): string {
  if (!c.closedAt) return '';
  const days = Math.max(1, Math.ceil((c.closedAt + closedVisibleDays * DAY - now) / DAY));
  return c.closedBy === 'expired' ? t.anonymous.conversation.expired({ days }) : t.anonymous.conversation.endedByTeam({ days });
}

/**
 * The parent message of an anonymous thread in the team channel ends with a status: open (with an end button), ended
 * (the author can still read it), or forgotten (the bot no longer knows the author; with a delete button). While an
 * encrypted conversation's text can be read, an open button comes first. The buttons carry no identifier: their
 * handlers find the conversation by the message they are on.
 */
export type TeamAnonState =
  | { state: 'open'; sendEmoji: string; closedVisibleDays: number }
  | { state: 'ended'; note: string }
  | { state: 'forgotten'; note: string };

const STATUS_BLOCK = 'anon_status';
const ACTIONS_BLOCK = 'anon_actions';

/** The button that opens an encrypted conversation for the team, also on the person's later messages. */
export function openButton(t: Strings): Button {
  return { type: 'button', action_id: 'anon_team_open', style: 'primary', text: plain(t.anonymous.team.openButton) };
}

/**
 * `kind`: whether the conversation is encrypted, which changes what deleting it deletes, and whether its text can
 * still be read, which gets the open button.
 */
export function teamAnonStatus(t: Strings, status: TeamAnonState, kind: { encrypted?: boolean; readable?: boolean } = {}): KnownBlock[] {
  const readable = Boolean(kind.readable);
  const encrypted = kind.encrypted ? 'yes' : 'no';
  const line = (text: string): KnownBlock => ({ ...context(text), block_id: STATUS_BLOCK });
  const actions = (...elements: Button[]): KnownBlock[] => {
    const all = [...(readable ? [openButton(t)] : []), ...elements];
    return all.length > 0 ? [{ type: 'actions', block_id: ACTIONS_BLOCK, elements: all }] : [];
  };
  switch (status.state) {
    case 'open':
      return [
        // An open conversation that can be read is encrypted: its keys only go once it has ended.
        line(readable ? t.anonymous.team.openStatusEncrypted : t.anonymous.team.openStatus({ sendEmoji: status.sendEmoji })),
        ...actions({
          type: 'button',
          action_id: 'anon_team_end',
          text: plain(t.anonymous.team.endButton),
          confirm: confirm(t, t.anonymous.team.endConfirmTitle, t.anonymous.team.endConfirm({ days: status.closedVisibleDays }), t.anonymous.team.endConfirmButton),
        }),
      ];
    case 'ended':
      return [line(status.note), ...actions()];
    case 'forgotten':
      return [
        line(`${status.note} ${t.anonymous.team.deletableStatus}`),
        ...actions(
            {
              type: 'button',
              action_id: 'anon_team_delete',
              style: 'danger',
              text: plain(t.anonymous.team.deleteButton),
              confirm: {
                ...confirm(t, t.anonymous.team.deleteConfirmTitle, t.anonymous.team.deleteConfirm({ encrypted }), t.anonymous.team.deleteConfirmButton),
                style: 'danger',
              },
            },
        ),
      ];
  }
}

/** The blocks of a parent message with its status replaced. */
export function withTeamAnonStatus(
  t: Strings,
  blocks: readonly unknown[],
  status: TeamAnonState,
  kind: { encrypted?: boolean; readable?: boolean } = {},
): KnownBlock[] {
  const kept = (blocks as KnownBlock[]).filter((b) => !isStatusBlock(b));
  return [...kept, ...teamAnonStatus(t, status, kind)];
}

export interface TeamConversationView {
  conversation: AnonConversation;
  /** Oldest first, with who in the team sent each reply, and when and by whom a message was last edited. */
  messages: {
    author: AnonMessage['author'];
    ts: string;
    sentBy: string | null;
    editedAt?: number | null;
    editedBy?: string | null;
    deleted?: boolean;
    deletedBy?: string | null;
    body: RichTextBlock | null;
  }[];
}

/**
 * An encrypted conversation for the team: the person's messages and the team's replies, decrypted, each reply with
 * who sent it and a menu to edit or delete it, which anyone in the team may do, and a reply box while it is open.
 * The conversation is known by its thread, which, unlike the author's handle, may show to the team.
 */
export function teamConversationView(
  t: Strings,
  { conversation, messages }: TeamConversationView,
  bot: Speaker,
  now = Date.now(),
  page: Page = {},
): ModalView {
  const open = !conversation.closedAt;
  const { shown, nav } = paged(t, messages, page.earlier ?? 0, 'anon_team_page');
  const blocks: KnownBlock[] = [context(open ? t.anonymous.teamWindow.intro : t.anonymous.teamWindow.ended), ...nav];

  for (const [i, message] of shown.entries()) {
    // The person's messages close together go under one line, as in the author's window, unless edited; each reply
    // has its own.
    const grouped = message.author === 'person' && together(message, shown[i - 1], (m) => Boolean(m.editedAt || m.deleted));
    if (!grouped) {
      if (i > 0) blocks.push(spacer());
      const edited = message.editedAt && !message.deleted ? ` · _${t.anonymous.conversation.editedMessage}_` : '';
      const personLine = context(`${t.anonymous.teamWindow.person}   ${slackDate(message.ts)}${edited}`);
      blocks.push(message.author === 'person' ? personLine : replyLine(t, message, bot));
    }
    const gone = message.author === 'person' ? t.anonymous.teamWindow.deletedByPerson : t.anonymous.conversation.deletedReply;
    blocks.push(message.deleted ? deletedLine(gone) : (message.body ?? { type: 'section', text: mrkdwn(t.anonymous.conversation.unavailable) }));
  }

  blocks.push(spacer());
  if (open) {
    blocks.push({ type: 'divider' }, {
      type: 'input',
      block_id: page.replyBlock ?? `${REPLY_BLOCK}${now}`,
      label: plain(t.anonymous.conversation.reply),
      element: { type: 'rich_text_input', action_id: 'reply' },
    });
  }
  return {
    type: 'modal',
    callback_id: 'anon_team_conversation',
    private_metadata: conversation.teamThreadTs ?? '',
    title: modalTitle(t.anonymous.conversation.title),
    close: plain(t.common.close),
    ...(open ? { submit: plain(t.anonymous.conversation.send) } : {}),
    blocks,
  };
}

/** Who sent a reply and when, with the menu to edit or delete it. */
function replyLine(t: Strings, message: TeamConversationView['messages'][number], bot: Speaker): KnownBlock {
  const who = message.sentBy ? ` · <@${message.sentBy}>` : '';
  // Once deleted, it says who deleted it instead, and has nothing left to edit or delete.
  if (message.deleted) {
    const deleted = message.deletedBy ? ` · _${t.anonymous.teamWindow.deletedBy({ user: message.deletedBy })}_` : '';
    return { type: 'section', text: mrkdwn(`*${bot.name}*${who}   ${slackDate(message.ts)}${deleted}`) };
  }
  const edited = message.editedBy ? ` · _${t.anonymous.teamWindow.editedBy({ user: message.editedBy })}_` : '';
  return {
    type: 'section',
    text: mrkdwn(`*${bot.name}*${who}   ${slackDate(message.ts)}${edited}`),
    accessory: messageMenu('anon_team_reply', message.ts, { edit: t.anonymous.teamWindow.edit, delete: t.anonymous.teamWindow.delete }),
  };
}

/** The menu to edit or delete a message, whose value says which, and which message: `edit:<ts>` or `delete:<ts>`. */
function messageMenu(actionId: string, ts: string, labels: { edit: string; delete: string }) {
  return {
    type: 'overflow' as const,
    action_id: actionId,
    options: [
      { text: plain(labels.edit), value: `edit:${ts}` },
      { text: plain(labels.delete), value: `delete:${ts}` },
    ],
  };
}

/** Editing a message from one of the windows: `metadata` says which, to the submission `callbackId`. */
export function editMessageView(
  t: Strings,
  window: { callbackId: string; metadata: string; title: string; label: string },
  body: RichTextBlock | null,
): ModalView {
  return {
    type: 'modal',
    callback_id: window.callbackId,
    private_metadata: window.metadata,
    title: modalTitle(window.title),
    submit: plain(t.common.save),
    close: plain(t.common.cancel),
    blocks: [
      {
        type: 'input',
        block_id: 'reply',
        label: plain(window.label),
        element: { type: 'rich_text_input', action_id: 'reply', initial_value: body ?? undefined, focus_on_load: true },
      },
    ],
  };
}

/** Confirms deleting a message from one of the windows. */
export function deleteMessageView(
  t: Strings,
  window: { callbackId: string; metadata: string; title: string; text: string; button: string },
): ModalView {
  return {
    type: 'modal',
    callback_id: window.callbackId,
    private_metadata: window.metadata,
    title: modalTitle(window.title),
    submit: plain(window.button),
    close: plain(t.common.cancel),
    blocks: [{ type: 'section', text: mrkdwn(window.text) }],
  };
}

/** Whether a block of a parent message is its status, or the buttons under it, which a change of status replaces. */
export function isStatusBlock(block: KnownBlock): boolean {
  return block.block_id === STATUS_BLOCK || block.block_id === ACTIONS_BLOCK;
}

function confirm(t: Strings, title: string, text: string, button: string) {
  return { title: plain(title), text: plain(text), confirm: plain(button), deny: plain(t.common.cancel) };
}
