import type { ContextBlock, KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { context, messageBody, slackDate } from '#src/slack/blocks.ts';
import {
  describeProblems,
  fileName,
  isImage,
  showImages,
  uploadCopies,
  type AttachedFile,
  type Copies,
} from '#src/slack/files.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';
import type { Conversation } from '#src/storage/index.ts';

/** A message someone sent the bot, by DM or @mention. */
export interface Incoming {
  user: string;
  text: string;
  blocks: readonly unknown[] | undefined;
  /** Its files, copied into the thread after the text. */
  files: readonly AttachedFile[];
  /** Set when relaying, late, a message sent while the bot was down. */
  lateTs?: string;
}

/**
 * What the relay did: the thread it started, if it started one, the message it posted, the notice showing the images,
 * the copies of the files, the files it couldn't copy, and the notice telling the team which.
 */
export interface Relayed extends Copies {
  started?: string;
  ts?: string;
  noticeTs?: string;
  problemsTs?: string;
}

/** Block IDs of the copy of the message in what the relay posts start with this, so an edit can find it. */
const BODY_BLOCK = 'relayed-body-';
const markBody = (blocks: KnownBlock[]): KnownBlock[] => blocks.map((b, i) => ({ ...b, block_id: `${BODY_BLOCK}${i}` }));

/**
 * Posts a message in its conversation thread in the team channel, with copies of its files. Without a thread (or if
 * its thread was deleted), starts one titled `header` and returns its ts, for the caller to record the conversation.
 * The team is told about files that couldn't be copied; telling the person is up to the caller, where they wrote.
 */
export type Relay = (
  client: WebClient,
  existing: Conversation | undefined,
  header: () => Promise<string> | string,
  message: Incoming,
) => Promise<Relayed>;

export function createRelay({ config, store, i18n, notices }: Deps): Relay {
  // Posted in the team channel, so in the team's language.
  const t = i18n.team;

  /** "🤖 Forwarded automatically: files from @person", as a notice looks: grey, small, with the notices' emoji. */
  const relayLine = (user: string) => context(`:${notices.emojiName}: _${t.files.relayed({ user })}_`);

  /**
   * Images go in a notice of their own. Other files can only be uploaded as the bot itself, so their message says it
   * is an automatic relay, with the notices' emoji, and each copy's title says whose it is. Whatever couldn't be copied
   * is told to the team.
   */
  async function copyFiles(client: WebClient, threadTs: string, message: Incoming): Promise<Omit<Relayed, 'started' | 'ts'>> {
    const images = message.files.filter(isImage);
    const others = message.files.filter((f) => !isImage(f));
    const copies: Omit<Relayed, 'started' | 'ts'> = { fileIds: [], problems: [] };
    if (images.length > 0) {
      const line = t.files.attached({ user: message.user });
      const shown = await showImages(client, images, (blocks) =>
        notices.post(client, { text: line, threadTs, blocks: [context(line), ...blocks] }),
      );
      Object.assign(copies, { noticeTs: shown.ts, fileIds: shown.fileIds, problems: shown.problems });
    }
    if (others.length > 0) {
      const person = await displayName(client, message.user);
      const options = {
        header: relayLine(message.user),
        title: (file: AttachedFile) => t.files.relayedTitle({ name: fileName(file), person }),
      };
      const uploaded = await uploadCopies(client, others, { channel: config.teamChannelId, threadTs }, options);
      copies.fileIds.push(...uploaded.fileIds);
      copies.problems.push(...uploaded.problems);
    }
    if (copies.problems.length > 0) {
      const list = describeProblems(t, copies.problems, 'team');
      copies.problemsTs = await notices.post(client, { text: t.files.notRelayed({ list }), threadTs });
    }
    return copies;
  }

  return async (client, existing, header, message) => {
    const body = (title: string) => {
      const blocks = [context(title), ...markBody(messageBody(richTextBlocks(message.blocks), message.text))];
      if (message.lateTs) blocks.push(context(t.inbox.thread.lateRelay({ date: slackDate(message.lateTs) })));
      return { text: `${title} ${message.text}`, blocks };
    };

    // Relayed by the bot on its own, so under the notices sender; the message keeps its full layout.
    let threadTs: string | undefined;
    let ts: string | undefined;
    let started: string | undefined;
    if (existing) {
      const followUp = body(t.inbox.thread.followUp({ user: message.user }));
      ts = await notices.post(client, { ...followUp, threadTs: existing.teamThreadTs });
      if (ts) {
        store.conversations.touch(existing.id);
        threadTs = existing.teamThreadTs;
      }
    }
    if (!threadTs) {
      const { text, blocks } = body(await header());
      blocks.push(context(t.inbox.thread.replyHint({ sendEmoji: config.sendEmoji })));
      threadTs = ts = started = await notices.post(client, { text, blocks });
    }
    const copies = threadTs && message.files.length > 0 ? await copyFiles(client, threadTs, message) : undefined;
    return { started, ts, fileIds: [], problems: [], ...copies };
  };
}

/**
 * The blocks of a relayed message with its copy of the message replaced by `body`, keeping the header above it and
 * the small print below it. The copy is found by its block IDs or, in messages relayed before it had them, as every
 * block but the context ones. The text that goes with the blocks starts with the header's.
 */
export function withBody(blocks: readonly unknown[], body: KnownBlock[], bodyText: string): { blocks: KnownBlock[]; text: string } {
  const all = blocks as KnownBlock[];
  const marked = all.some((b) => b.block_id?.startsWith(BODY_BLOCK));
  const inBody = (b: KnownBlock) => (marked ? Boolean(b.block_id?.startsWith(BODY_BLOCK)) : b.type !== 'context');
  const kept = all.filter((b) => !inBody(b));
  // Where the copy was, or else under the header: everything before the copy is kept, so the index is the same.
  const first = all.findIndex(inBody);
  const at = first === -1 ? Math.min(1, kept.length) : first;
  const header = kept[0]?.type === 'context' ? (kept[0] as ContextBlock) : undefined;
  const headerText = header?.elements.map((e) => ('text' in e ? e.text : '')).join(' ') ?? '';
  return { blocks: [...kept.slice(0, at), ...markBody(body), ...kept.slice(at)], text: `${headerText} ${bodyText}`.trim() };
}

/** How a person's name shows in Slack, for the titles of their files; their ID if Slack can't say. */
async function displayName(client: WebClient, userId: string): Promise<string> {
  try {
    const { user } = await client.users.info({ user: userId });
    return user?.profile?.display_name || user?.real_name || user?.name || userId;
  } catch {
    return userId;
  }
}
