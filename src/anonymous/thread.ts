import type { App } from '@slack/bolt';
import type { RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { context } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { fetchMessage, postInThread, threadMessages } from '#src/slack/messages.ts';
import { plainText } from '#src/slack/richtext.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import { newHandle } from './keys.ts';
import { teamAnonStatus, withTeamAnonStatus, type TeamAnonState } from './views.ts';

/** What the bot does in the team channel for anonymous conversations: one thread each, posted as the bot. */
export interface AnonymousThread {
  /** Posts a new conversation's first message and records it. False if it couldn't be posted. */
  open(client: WebClient, owner: string, message: RichTextBlock): Promise<boolean>;
  /** Posts the author's next message. 'gone' if the team deleted the thread by hand, which ends the conversation. */
  followUp(client: WebClient, conversation: AnonConversation, message: RichTextBlock): Promise<'sent' | 'failed' | 'gone'>;
  /** Replaces the status (and buttons) at the end of the thread's first message. */
  setStatus(
    client: WebClient,
    conversation: AnonConversation,
    status: TeamAnonState,
    parent?: { ts: string; text?: string; blocks?: unknown[] },
  ): Promise<void>;
  /** A short note in the thread, such as who ended the conversation. */
  note(client: WebClient, conversation: AnonConversation, text: string): Promise<void>;
  /** A notice in the thread that only `user` sees. */
  ephemeral(client: WebClient, conversation: AnonConversation, user: string, text: string): Promise<void>;
  /**
   * Deletes everything the bot posted in the thread, the author's messages included, and every record of the
   * conversation. Team members' own replies stay: only their authors can delete them.
   */
  remove(client: WebClient, conversation: AnonConversation, leaveNote?: string): Promise<void>;
}

export function createThread(app: App, { config, store, bot, i18n }: Deps): AnonymousThread {
  const channel = config.teamChannelId;
  // Everything here is posted in the team channel, so in the team's language.
  const t = i18n.team;
  const openStatus: TeamAnonState = {
    state: 'open',
    sendEmoji: config.sendEmoji,
    closedVisibleDays: config.anonClosedVisibleDays,
  };

  return {
    async open(client, owner, message) {
      const conversation = store.anonymous.reserve(owner, newHandle);
      const header = t.anonymous.team.header;
      let ts: string | undefined;
      try {
        const posted = await client.chat.postMessage({
          channel,
          text: `${header} ${plainText(message)}`,
          blocks: [context(header), message, ...teamAnonStatus(t, openStatus)],
          unfurl_links: false,
        });
        ts = posted.ts;
      } catch (error) {
        app.logger.error(`Could not post an anonymous message: ${errorCode(error)}`);
      }
      if (!ts) {
        store.anonymous.drop(conversation.id);
        return false;
      }
      store.anonymous.setThread(conversation.id, ts);
      store.anonymous.addMessage(ts, conversation.id, 'person', null);
      return true;
    },

    async followUp(client, conversation, message) {
      const header = t.anonymous.team.followUp;
      let ts: string | undefined;
      try {
        ts = await postInThread(client, {
          channel,
          thread_ts: conversation.teamThreadTs!,
          text: `${header} ${plainText(message)}`,
          blocks: [context(header), message],
          unfurl_links: false,
        });
        if (!ts) {
          store.anonymous.close(conversation.id, 'team');
          return 'gone';
        }
      } catch (error) {
        app.logger.error(`Could not post an anonymous message: ${errorCode(error)}`);
        return 'failed';
      }
      store.anonymous.addMessage(ts, conversation.id, 'person', null);
      store.anonymous.touch(conversation.id);
      return 'sent';
    },

    async setStatus(client, conversation, status, parent) {
      const ts = conversation.teamThreadTs;
      if (!ts) return;
      const message = parent ?? (await fetchMessage(client, channel, ts));
      if (!message?.blocks) return;
      await client.chat.update({ channel, ts, text: message.text ?? '', blocks: withTeamAnonStatus(t, message.blocks, status) });
    },

    async note(client, conversation, text) {
      if (conversation.teamThreadTs) await postInThread(client, { channel, thread_ts: conversation.teamThreadTs, text });
    },

    async ephemeral(client, conversation, user, text) {
      await client.chat.postEphemeral({ channel, user, thread_ts: conversation.teamThreadTs ?? undefined, text });
    },

    async remove(client, conversation, leaveNote) {
      const ts = conversation.teamThreadTs;
      if (!ts) return;
      const kept = leaveNote ? await postInThread(client, { channel, thread_ts: ts, text: leaveNote }) : undefined;
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
