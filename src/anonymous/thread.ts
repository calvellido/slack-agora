import type { App } from '@slack/bolt';
import type { KnownBlock, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { serialized } from '#src/lib/serialized.ts';
import { context } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { fetchMessage, threadMessages } from '#src/slack/messages.ts';
import { plainText, richTextBlocks } from '#src/slack/richtext.ts';
import type { AnonConversation, AnonMessage } from '#src/storage/index.ts';
import { decrypt, encrypt } from './content.ts';
import { newHandle } from './keys.ts';
import { isStatusBlock, openButton, teamAnonStatus, withTeamAnonStatus, type TeamAnonState } from './views.ts';

/** A message of a conversation as the windows show it. */
export interface ReadMessage {
  author: AnonMessage['author'];
  ts: string;
  sentBy: string | null;
  /** When it was last edited, and, for a reply, by which team member; null if never. */
  editedAt: number | null;
  editedBy: string | null;
  /** Deleted, by the author or, for a reply, by a team member, `deletedBy`: shown in its place, without its text. */
  deleted: boolean;
  deletedBy: string | null;
  createdAt: number;
  /** Null when it is no longer available: deleted, gone from the team channel, or its key destroyed. */
  body: RichTextBlock | null;
}

type Sent = 'sent' | 'failed' | 'gone';

/**
 * What the bot does in the team channel for anonymous conversations: one thread each, posted as the bot. An encrypted
 * conversation's text is kept in the database, encrypted, and its thread only holds placeholders; one from before
 * encryption, or with ANON_ENCRYPTED=false, has its text in the thread, and the team replies there.
 */
export interface AnonymousThread {
  /** Posts a new conversation's first message and records it. False if it couldn't be posted. */
  open(client: WebClient, owner: string, message: RichTextBlock): Promise<boolean>;
  /** Posts the author's next message. 'gone' if the team deleted the thread by hand, which ends the conversation. */
  followUp(client: WebClient, conversation: AnonConversation, message: RichTextBlock): Promise<Sent>;
  /** Posts a team member's reply to an encrypted conversation, sent from the team's window. */
  reply(client: WebClient, conversation: AnonConversation, user: string, message: RichTextBlock): Promise<Sent>;
  /**
   * Replaces the text of a reply to an encrypted conversation, and says in its placeholder who edited it. False if
   * the reply was deleted meanwhile.
   */
  editReply(client: WebClient, conversation: AnonConversation, ts: string, message: RichTextBlock, user: string): Promise<boolean>;
  /**
   * The author edits one of their own messages: its text is replaced, and its message in the thread says so. False if
   * it couldn't be, as when the thread holds its text and Slack refused to change it.
   */
  editMessage(client: WebClient, conversation: AnonConversation, ts: string, message: RichTextBlock): Promise<boolean>;
  /** The author deletes one of their own messages, which says so in the thread. False if it couldn't be. */
  deleteMessage(client: WebClient, conversation: AnonConversation, ts: string): Promise<boolean>;
  /**
   * Withdraws a reply, so the author only sees that it was, and says who did in the thread: in its placeholder, when
   * encrypted. False if it already was.
   */
  withdrawReply(client: WebClient, conversation: AnonConversation, ts: string, user: string): Promise<boolean>;
  /** The conversation's messages, oldest first, with their text. */
  read(client: WebClient, conversation: AnonConversation): Promise<ReadMessage[]>;
  /** One message's text, as `read` gives it. */
  readOne(client: WebClient, conversation: AnonConversation, ts: string): Promise<RichTextBlock | null>;
  /** Replaces the status (and buttons) at the end of the thread's first message. */
  setStatus(client: WebClient, conversation: AnonConversation, status: TeamAnonState): Promise<void>;
  /** Once a conversation's key is destroyed: its status says so, and the open buttons go from its thread. */
  textDestroyed(client: WebClient, conversation: AnonConversation, status: TeamAnonState): Promise<void>;
  /** A notice in the thread, such as who ended the conversation. */
  note(client: WebClient, conversation: AnonConversation, text: string): Promise<void>;
  /**
   * Deletes everything the bot posted in the thread, the author's messages included, and, when encrypted, the team's
   * replies, and every record of the conversation. Team members' own messages stay: only their authors can delete
   * them.
   */
  remove(client: WebClient, conversation: AnonConversation, leaveNote?: string): Promise<void>;
}

export function createThread(app: App, { config, store, bot, i18n, notices, anonContent }: Deps): AnonymousThread {
  const channel = config.teamChannelId;
  // Everything here is posted in the team channel, so in the team's language.
  const t = i18n.team;
  const openStatus: TeamAnonState = { state: 'open', sendEmoji: config.sendEmoji, closedVisibleDays: config.anonClosedVisibleDays };
  const readable = (c: AnonConversation) => c.encrypted && c.contentKey !== null;
  const kind = (c: AnonConversation) => ({ encrypted: c.encrypted, readable: readable(c) });
  const sealed = (c: AnonConversation, message: RichTextBlock) => encrypt(anonContent.key(c.contentKey!), JSON.stringify(message));
  /** Changes to a thread's messages one after another, so a status change and an edit don't undo each other. */
  const inTurn = <T>(c: AnonConversation, task: () => Promise<T>) => serialized(`anon-thread:${c.teamThreadTs}`, task);

  /** A message's text, decrypted; null if it can't be, as when its key was destroyed. */
  function opened(c: AnonConversation, content: string | null): RichTextBlock | null {
    if (!c.contentKey || !content) return null;
    try {
      return richTextBlocks([JSON.parse(decrypt(anonContent.key(c.contentKey), content))])[0] ?? null;
    } catch (error) {
      app.logger.error(`Could not decrypt an anonymous message: ${errorCode(error)}`);
      return null;
    }
  }

  /** Block ID of the line saying the author edited a message of theirs. */
  const EDITED_BLOCK = 'anon_edited';

  /**
   * Changes how one of the author's messages shows in the thread, in place: edited, with its new text unless it is
   * encrypted, or deleted. Its header line stays first, and, on the thread's first message, the status and buttons
   * last. False if Slack refused, or the message is gone.
   */
  function showChange(client: WebClient, c: AnonConversation, ts: string, change: { text: RichTextBlock | null } | 'deleted') {
    return inTurn(c, async () => {
      try {
        const message = await fetchMessage(client, channel, ts);
        if (!message?.blocks) return false;
        const blocks = (message.blocks as KnownBlock[]).filter((b) => b.block_id !== EDITED_BLOCK);
        const [header, ...body] = blocks.filter((b) => !isStatusBlock(b));
        const headerText = header?.type === 'context' ? header.elements.map((e) => ('text' in e ? e.text : '')).join(' ') : '';
        const changed: KnownBlock[] =
          change === 'deleted'
            ? [context(t.anonymous.team.personDeleted)]
            : [...(change.text ? [change.text] : body), { ...context(t.anonymous.team.personEdited), block_id: EDITED_BLOCK }];
        const text =
          change === 'deleted'
            ? `${headerText} ${t.anonymous.team.personDeleted}`
            : change.text ? `${headerText} ${plainText(change.text)}` : (message.text ?? headerText);
        const all = [...(header ? [header] : []), ...changed, ...blocks.filter(isStatusBlock)];
        await client.chat.update({ channel, ts, text, blocks: all });
        return true;
      } catch (error) {
        app.logger.error(`Could not show an anonymous message's change: ${errorCode(error)}`);
        return false;
      }
    });
  }

  /** Posts in the conversation's thread. Undefined if the thread is gone, which ends the conversation. */
  async function postInThread(c: AnonConversation, client: WebClient, text: string, blocks: KnownBlock[]) {
    const ts = await notices.post(client, { text, blocks, threadTs: c.teamThreadTs! });
    if (!ts) store.anonymous.close(c.id, 'team');
    return ts;
  }

  return {
    async open(client, owner, message) {
      const key = config.anonEncrypted ? anonContent.newKey() : undefined;
      const conversation = store.anonymous.reserve(owner, newHandle, key?.kept ?? null);
      const header = t.anonymous.team.header;
      const status = teamAnonStatus(t, openStatus, kind(conversation));
      // Encrypted, the thread only says there is a message, with the button to read it.
      const body: KnownBlock[] = key ? [{ type: 'section', text: { type: 'mrkdwn', text: t.anonymous.team.locked } }] : [message];
      let ts: string | undefined;
      try {
        ts = await notices.post(client, {
          text: key ? header : `${header} ${plainText(message)}`,
          blocks: [context(header), ...body, ...status],
        });
      } catch (error) {
        app.logger.error(`Could not post an anonymous message: ${errorCode(error)}`);
      }
      if (!ts) {
        store.anonymous.drop(conversation.id);
        return false;
      }
      store.anonymous.setThread(conversation.id, ts);
      store.anonymous.addMessage(ts, conversation.id, 'person', null, key ? sealed(conversation, message) : null);
      return true;
    },

    async followUp(client, conversation, message) {
      const encrypted = conversation.encrypted;
      let ts: string | undefined;
      try {
        // Encrypted first, so nothing is posted that couldn't be recorded; never in the clear without its key.
        const content = encrypted ? sealed(conversation, message) : null;
        const header = encrypted ? t.anonymous.team.followUpLocked : t.anonymous.team.followUp;
        const blocks: KnownBlock[] = encrypted
          ? [context(header), { type: 'actions', elements: [openButton(t)] }]
          : [context(header), message];
        ts = await postInThread(conversation, client, encrypted ? header : `${header} ${plainText(message)}`, blocks);
        if (!ts) return 'gone';
        store.anonymous.addMessage(ts, conversation.id, 'person', null, content);
      } catch (error) {
        app.logger.error(`Could not post an anonymous message: ${errorCode(error)}`);
        return 'failed';
      }
      store.anonymous.touch(conversation.id);
      return 'sent';
    },

    async reply(client, conversation, user, message) {
      if (!readable(conversation)) return 'failed';
      const text = t.anonymous.team.replied({ user });
      try {
        const content = sealed(conversation, message);
        const ts = await postInThread(conversation, client, text, [context(text)]);
        if (!ts) return 'gone';
        store.anonymous.addMessage(ts, conversation.id, 'team', user, content);
      } catch (error) {
        app.logger.error(`Could not post an anonymous reply: ${errorCode(error)}`);
        return 'failed';
      }
      store.anonymous.touch(conversation.id);
      return 'sent';
    },

    async editReply(client, conversation, ts, message, user) {
      if (!store.anonymous.setContent(ts, sealed(conversation, message), user)) return false;
      // Its placeholder says who edited it last, with no notification, as anyone in the team may edit any reply.
      const sentBy = store.anonymous.message(ts)?.sentBy ?? user;
      const text = t.anonymous.team.repliedEdited({ user: sentBy, editor: user });
      await client.chat.update({ channel, ts, text, blocks: [context(text)] }).catch((error: unknown) => {
        app.logger.error(`Could not mark an anonymous reply as edited: ${errorCode(error)}`);
      });
      return true;
    },

    async editMessage(client, conversation, ts, message) {
      // Unnamed: the author's own edit.
      if (conversation.encrypted) {
        // Its text changes only in the database; the thread just says it was edited.
        if (!conversation.contentKey || !store.anonymous.setContent(ts, sealed(conversation, message), null)) return false;
        await showChange(client, conversation, ts, { text: null });
        return true;
      }
      // Its text is in the thread, so the edit only counts once the thread shows it.
      return (await showChange(client, conversation, ts, { text: message })) && store.anonymous.setContent(ts, null, null);
    },

    async deleteMessage(client, conversation, ts) {
      if (conversation.encrypted) {
        if (!store.anonymous.markMessageDeleted(ts)) return false;
        await showChange(client, conversation, ts, 'deleted');
        return true;
      }
      // Its text is in the thread: until it is gone from there, the message isn't deleted.
      return (await showChange(client, conversation, ts, 'deleted')) && store.anonymous.markMessageDeleted(ts);
    },

    async withdrawReply(client, conversation, ts, user) {
      if (!store.anonymous.markMessageDeleted(ts, user)) return false;
      if (conversation.encrypted) {
        // Its placeholder, the bot's, says so in place, as edits do, without notifying anyone.
        const sentBy = store.anonymous.message(ts)?.sentBy ?? user;
        const text = t.anonymous.team.repliedDeleted({ user: sentBy, deleter: user });
        await client.chat.update({ channel, ts, text, blocks: [context(text)] }).catch((error: unknown) => {
          app.logger.error(`Could not mark an anonymous reply as deleted: ${errorCode(error)}`);
        });
        return true;
      }
      // Otherwise it is the team member's own message, which the bot can't change: it loses its sent mark, and a note
      // says who withdrew it.
      await client.reactions.remove({ channel, timestamp: ts, name: 'white_check_mark' }).catch(() => {});
      await notices.post(client, { text: t.anonymous.team.replyDeleted({ user }), threadTs: conversation.teamThreadTs ?? ts });
      return true;
    },

    async read(client, conversation) {
      const stored = store.anonymous.allMessages(conversation.id);
      const base = (m: AnonMessage) => ({
        author: m.author,
        ts: m.teamMessageTs,
        sentBy: m.sentBy,
        editedAt: m.editedAt,
        editedBy: m.editedBy,
        deleted: m.deletedAt !== null,
        deletedBy: m.deletedBy,
        createdAt: m.createdAt,
      });
      if (conversation.encrypted) return stored.map((m) => ({ ...base(m), body: opened(conversation, m.content) }));
      const posted = await threadMessages(client, channel, conversation.teamThreadTs!);
      return stored.map((m) => {
        // A withdrawn reply here is the team member's own message, still in the thread: never shown again.
        const found = m.deletedAt ? undefined : posted.get(m.teamMessageTs);
        return { ...base(m), body: (found && richTextBlocks(found.blocks)[0]) ?? null };
      });
    },

    async readOne(client, conversation, ts) {
      if (conversation.encrypted) return opened(conversation, store.anonymous.message(ts)?.content ?? null);
      const found = await fetchMessage(client, channel, ts);
      return (found && richTextBlocks(found.blocks)[0]) ?? null;
    },

    async setStatus(client, conversation, status) {
      const ts = conversation.teamThreadTs;
      if (!ts) return;
      await inTurn(conversation, async () => {
        // Read as it stands now, so an edit or deletion made meanwhile stays.
        const message = await fetchMessage(client, channel, ts);
        if (!message?.blocks) return;
        const blocks = withTeamAnonStatus(t, message.blocks, status, kind(conversation));
        await client.chat.update({ channel, ts, text: message.text ?? '', blocks });
      });
    },

    async textDestroyed(client, conversation, status) {
      await this.setStatus(client, conversation, status);
      const ts = conversation.teamThreadTs;
      if (!ts) return;
      // The person's later messages lose their open button too: there is nothing left to open.
      const opens = (b: KnownBlock) => b.type === 'actions' && !isStatusBlock(b) && JSON.stringify(b).includes('anon_team_open');
      for (const message of (await threadMessages(client, channel, ts)).values()) {
        const blocks = (message.blocks ?? []) as KnownBlock[];
        if (!message.ts || message.ts === ts || message.bot_id !== bot.botId || !blocks.some(opens)) continue;
        await client.chat
          .update({ channel, ts: message.ts, text: message.text ?? '', blocks: blocks.filter((b) => !opens(b)) })
          .catch((error: unknown) => app.logger.error(`Could not update an anonymous message: ${errorCode(error)}`));
      }
    },

    async note(client, conversation, text) {
      if (conversation.teamThreadTs) await notices.post(client, { text, threadTs: conversation.teamThreadTs });
    },

    async remove(client, conversation, leaveNote) {
      const ts = conversation.teamThreadTs;
      if (!ts) return;
      const kept = leaveNote ? await notices.post(client, { text: leaveNote, threadTs: ts }) : undefined;
      const ours = [...(await threadMessages(client, channel, ts)).values()]
        .filter((m) => m.ts && m.ts !== kept && m.bot_id === bot.botId)
        // The parent goes last: deleted while it still has replies, Slack leaves a "deleted message" placeholder.
        .sort((a, b) => Number(a.ts === ts) - Number(b.ts === ts));
      for (const message of ours) {
        try {
          await client.chat.delete({ channel, ts: message.ts! });
        } catch (error) {
          if (errorCode(error) !== 'message_not_found') app.logger.error(`Could not delete a message: ${errorCode(error)}`);
        }
      }
      store.anonymous.remove(conversation.id);
    },
  };
}
