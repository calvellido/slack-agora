import type { KnownBlock } from '@slack/types';
import type { ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import { errorCode } from './errors.ts';

// Reading and posting messages, with the quirks of Slack's API handled once.

export type SlackMessage = NonNullable<ConversationsRepliesResponse['messages']>[number];

/** A single message, top-level or in a thread. */
export async function fetchMessage(client: WebClient, channel: string, ts: string): Promise<SlackMessage | undefined> {
  try {
    const { messages } = await client.conversations.replies({ channel, ts, oldest: ts, latest: ts, inclusive: true });
    return messages?.find((m) => m.ts === ts);
  } catch (error) {
    if (errorCode(error) === 'thread_not_found') return undefined;
    throw error;
  }
}

/** All the messages of a thread, by ts. Empty if the thread is gone. */
export async function threadMessages(client: WebClient, channel: string, ts: string): Promise<Map<string, SlackMessage>> {
  const byTs = new Map<string, SlackMessage>();
  let cursor: string | undefined;
  do {
    let page;
    try {
      page = await client.conversations.replies({ channel, ts, cursor, limit: 200 });
    } catch (error) {
      if (errorCode(error) === 'thread_not_found') return byTs;
      throw error;
    }
    for (const message of page.messages ?? []) if (message.ts) byTs.set(message.ts, message);
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return byTs;
}

interface ThreadPost {
  channel: string;
  thread_ts: string;
  text: string;
  blocks?: KnownBlock[];
  unfurl_links?: boolean;
}

/**
 * Posts in a thread and returns the ts. When the thread no longer exists (its first message was deleted), Slack
 * posts a standalone message instead: that one is taken back and undefined returned, so the caller can start over.
 */
export async function postInThread(client: WebClient, message: ThreadPost): Promise<string | undefined> {
  const posted = await client.chat.postMessage(message);
  if (!posted.ts || posted.message?.thread_ts === message.thread_ts) return posted.ts;
  if (await fetchMessage(client, message.channel, message.thread_ts)) return posted.ts;
  await client.chat.delete({ channel: message.channel, ts: posted.ts }).catch(() => {});
  return undefined;
}
