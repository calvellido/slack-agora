import type { ActionsBlock, KnownBlock, ModalView, RichTextBlock } from '@slack/types';
import type { Strings } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import { context, modalTitle, slackDate } from '#src/slack/blocks.ts';
import type { AnonConversation, AnonMessage } from '#src/storage/index.ts';

// Views of anonymous mode, in the language of `t`. Nothing here may contain the author's identity. They are all modals, never the Home tab:
// Slack shows the last published Home tab whenever the bot is opened, so anything there could be seen over a shoulder.

const plain = (text: string) => ({ type: 'plain_text' as const, text });
const mrkdwn = (text: string) => ({ type: 'mrkdwn' as const, text });

/** The form to start an anonymous conversation. */
export function anonModal(t: Strings, message?: RichTextBlock): ModalView {
  return {
    type: 'modal',
    callback_id: 'anon_message',
    title: plain(t.anonymous.form.title),
    submit: plain(t.anonymous.form.submit),
    close: plain(t.common.cancel),
    blocks: [
      { type: 'section', text: mrkdwn(t.anonymous.form.intro) },
      {
        type: 'input',
        block_id: 'message',
        label: plain(t.anonymous.form.message),
        element: { type: 'rich_text_input', action_id: 'message', initial_value: message, focus_on_load: true },
      },
      context(t.anonymous.form.privacy),
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
    blocks.push({ type: 'divider' }, { type: 'section', text: mrkdwn(t.anonymous.window.conversations) });
    for (const { conversation, lastTs, hasNew } of items.slice(0, INBOX_MAX_CONVERSATIONS)) {
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
  blocks.push({ type: 'divider' }, context(t.anonymous.form.privacy));
  return { type: 'modal', callback_id: 'anon_inbox', title: modalTitle(t.anonymous.window.title), close: plain(t.common.close), blocks };
}

export interface ConversationView {
  conversation: AnonConversation;
  /** Oldest first. */
  messages: {
    author: AnonMessage['author'];
    ts: string;
    /** Null when the message is gone from the team channel. */
    body: RichTextBlock | null;
    isNew: boolean;
  }[];
}

/** Who answers in the window: the bot, as it appears in Slack. */
export interface Speaker {
  name: string;
  avatar?: string;
}

/** Most messages shown, to stay below a modal's 100 blocks. */
export const CONVERSATION_MAX_MESSAGES = 40;

/** Messages from the same side this close together go under one header, as in a Slack channel. */
const GROUP_SECONDS = 10 * 60;

/** Block IDs of the reply box start with this; the rest changes on every render so the box comes back empty. */
export const REPLY_BLOCK = 'reply-';

/** One conversation as a chat, with a reply box while it is open. */
export function conversationView(
  t: Strings,
  { conversation, messages }: ConversationView,
  bot: Speaker,
  closedVisibleDays: number,
  now = Date.now(),
): ModalView {
  const open = !conversation.closedAt;
  const shown = messages.slice(-CONVERSATION_MAX_MESSAGES);
  const blocks: KnownBlock[] = [];

  const status = closedStatus(t, conversation, closedVisibleDays, now);
  if (status) blocks.push({ type: 'section', text: mrkdwn(status) }, { type: 'divider' });
  if (messages.length > shown.length) blocks.push(context(t.anonymous.conversation.hidden({ count: messages.length - shown.length })));

  const groups: (typeof shown)[] = [];
  for (const message of shown) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (group && last?.author === message.author && Number(message.ts) - Number(last.ts) < GROUP_SECONDS) {
      group.push(message);
    } else {
      groups.push([message]);
    }
  }
  for (const group of groups) {
    const first = group[0]!;
    blocks.push(speakerLine(t, first.author, first.ts, group.some((m) => m.isNew), bot));
    for (const message of group) blocks.push(message.body ?? { type: 'section', text: mrkdwn(t.anonymous.conversation.unavailable) });
  }

  if (open) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'input',
        block_id: `${REPLY_BLOCK}${now}`,
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

function speakerLine(t: Strings, author: AnonMessage['author'], ts: string, isNew: boolean, bot: Speaker): KnownBlock {
  const when = [slackDate(ts), isNew ? t.anonymous.conversation.new : ''].filter(Boolean).join(' ');
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

/** Confirms ending a conversation, optionally deleting the author's messages from the team channel. */
export function endView(t: Strings, handle: string): ModalView {
  return {
    type: 'modal',
    callback_id: 'anon_end',
    private_metadata: handle,
    title: modalTitle(t.anonymous.conversation.title),
    submit: plain(t.anonymous.end.submit),
    close: plain(t.common.cancel),
    blocks: [
      { type: 'section', text: mrkdwn(t.anonymous.end.intro) },
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
      context(t.anonymous.end.deleteHint),
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
 * (the author can still read it), or forgotten (the bot no longer knows the author; with a delete button). The buttons
 * carry no identifier: their handlers find the conversation by the message they are on.
 */
export type TeamAnonState =
  | { state: 'open'; sendEmoji: string; closedVisibleDays: number }
  | { state: 'ended'; note: string }
  | { state: 'forgotten'; note: string };

const STATUS_BLOCK = 'anon_status';
const ACTIONS_BLOCK = 'anon_actions';

export function teamAnonStatus(t: Strings, status: TeamAnonState): KnownBlock[] {
  const line = (text: string): KnownBlock => ({ ...context(text), block_id: STATUS_BLOCK });
  switch (status.state) {
    case 'open':
      return [
        line(t.anonymous.team.openStatus({ sendEmoji: status.sendEmoji })),
        {
          type: 'actions',
          block_id: ACTIONS_BLOCK,
          elements: [
            {
              type: 'button',
              action_id: 'anon_team_end',
              text: plain(t.anonymous.team.endButton),
              confirm: confirm(t, t.anonymous.team.endConfirmTitle, t.anonymous.team.endConfirm({ days: status.closedVisibleDays }), t.anonymous.team.endConfirmButton),
            },
          ],
        },
      ];
    case 'ended':
      return [line(status.note)];
    case 'forgotten':
      return [
        line(`${status.note} ${t.anonymous.team.deletableStatus}`),
        {
          type: 'actions',
          block_id: ACTIONS_BLOCK,
          elements: [
            {
              type: 'button',
              action_id: 'anon_team_delete',
              style: 'danger',
              text: plain(t.anonymous.team.deleteButton),
              confirm: {
                ...confirm(t, t.anonymous.team.deleteConfirmTitle, t.anonymous.team.deleteConfirm, t.anonymous.team.deleteConfirmButton),
                style: 'danger',
              },
            },
          ],
        },
      ];
  }
}

/** The blocks of a parent message with its status replaced. */
export function withTeamAnonStatus(t: Strings, blocks: readonly unknown[], status: TeamAnonState): KnownBlock[] {
  const kept = (blocks as KnownBlock[]).filter((b) => b.block_id !== STATUS_BLOCK && b.block_id !== ACTIONS_BLOCK);
  return [...kept, ...teamAnonStatus(t, status)];
}

function confirm(t: Strings, title: string, text: string, button: string) {
  return { title: plain(title), text: plain(text), confirm: plain(button), deny: plain(t.common.cancel) };
}
