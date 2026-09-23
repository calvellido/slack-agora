import type { ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import type { ContextBlock, KnownBlock, RichTextBlock } from '@slack/types';
import type { Config } from './config.ts';
import type { I18n } from './i18n/index.ts';
import type { Store } from './store.ts';

export interface Deps {
  config: Config;
  store: Store;
  team: TeamDirectory;
  /** Keyed hash identifying the author of anonymous conversations (see anonymity.ts). */
  anonOwner: (userId: string) => string;
  bot: BotIdentity;
  i18n: I18n;
}

/** How the bot appears in Slack, read from its own profile. */
export interface BotIdentity {
  botId: string;
  userId: string;
  name: string;
  avatar?: string;
}

export async function botIdentity(client: WebClient): Promise<BotIdentity> {
  const auth = await client.auth.test();
  if (!auth.bot_id || !auth.user_id) throw new Error('SLACK_BOT_TOKEN is not a bot token');
  const { user } = await client.users.info({ user: auth.user_id });
  return {
    botId: auth.bot_id,
    userId: auth.user_id,
    name: user?.profile?.display_name || user?.real_name || user?.name || 'Bot',
    avatar: user?.profile?.image_72,
  };
}

/** Slack rejects modal titles longer than 24 characters, and a bot name can make them longer. */
export function modalTitle(text: string): { type: 'plain_text'; text: string } {
  return { type: 'plain_text', text: text.length > 24 ? `${text.slice(0, 23)}…` : text };
}

export type SlackMessage = NonNullable<ConversationsRepliesResponse['messages']>[number];

/** Who is in the team channel, which is who may act as the bot. */
export class TeamDirectory {
  #client: WebClient;
  #channelId: string;
  #ttlMs: number;
  #members = new Set<string>();
  #fetchedAt = 0;

  constructor(client: WebClient, channelId: string, ttlMs = 5 * 60_000) {
    this.#client = client;
    this.#channelId = channelId;
    this.#ttlMs = ttlMs;
  }

  async isMember(userId: string): Promise<boolean> {
    if (Date.now() - this.#fetchedAt > this.#ttlMs) {
      const members = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await this.#client.conversations.members({ channel: this.#channelId, cursor, limit: 200 });
        for (const id of page.members ?? []) members.add(id);
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      this.#members = members;
      this.#fetchedAt = Date.now();
    }
    return this.#members.has(userId);
  }
}

export const DAY = 24 * 60 * 60_000;

const queues = new Map<string, Promise<unknown>>();

/** Runs tasks with the same key one after another, so messages keep their order and threads aren't duplicated. */
export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
    .catch(() => {});
  return next;
}

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

/** All the messages of a thread, by ts. */
export async function threadMessages(client: WebClient, channel: string, ts: string): Promise<Map<string, SlackMessage>> {
  const byTs = new Map<string, SlackMessage>();
  let cursor: string | undefined;
  do {
    const page = await client.conversations.replies({ channel, ts, cursor, limit: 200 });
    for (const message of page.messages ?? []) if (message.ts) byTs.set(message.ts, message);
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return byTs;
}

/** A date each viewer sees in their own timezone and language. */
export function slackDate(ts: string): string {
  const seconds = Math.floor(Number(ts));
  const fallback = new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
  return `<!date^${seconds}^{date_short_pretty} {time}|${fallback} UTC>`;
}

export function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

/** A header line followed by a copy of someone's message. */
export function quoted(header: string, message: RichTextBlock[], fallback = ''): KnownBlock[] {
  const body: KnownBlock[] =
    message.length > 0
      ? message
      : fallback
        ? [{ type: 'section', text: { type: 'mrkdwn', text: fallback.slice(0, 3000) } }]
        : [];
  return [context(header), ...body];
}

/** The Slack error code (e.g. `not_in_channel`) when there is one. */
export function errorCode(error: unknown): string {
  const data = (error as { data?: { error?: unknown } }).data;
  if (typeof data?.error === 'string') return data.error;
  return error instanceof Error ? error.message : String(error);
}
