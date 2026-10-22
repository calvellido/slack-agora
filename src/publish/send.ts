import type { KnownBlock, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { serialized } from '#src/lib/serialized.ts';
import { DAY } from '#src/lib/time.ts';
import { context, escapeMrkdwn, quoted } from '#src/slack/blocks.ts';
import { describeError } from '#src/slack/errors.ts';
import {
  copiedNames,
  describeProblems,
  fileName,
  isImage,
  showImages,
  uploadCopies,
  type AttachedFile,
  type Copies,
} from '#src/slack/files.ts';
import { plainText } from '#src/slack/richtext.ts';

/** What is posted: a message, files from the message the form started from, or both. */
export interface Post {
  message?: RichTextBlock;
  files: readonly AttachedFile[];
}

/** How a send went, for the form to tell whoever posted: the record in the team channel tells the team. */
export type Outcome =
  | { status: 'sent'; permalink?: string; problems: Copies['problems'] }
  | { status: 'nothing'; problems: Copies['problems'] }
  | { status: 'failed'; error: unknown };

/** Sending as the bot. Each send leaves a record in the team channel saying who sent it, which can delete it later. */
export interface Sender {
  toChannel(client: WebClient, poster: string, channel: string, post: Post): Promise<Outcome>;
  /** DMs someone as the bot. Their answers land in the same team channel thread as the message. */
  toPerson(client: WebClient, poster: string, user: string, post: Post): Promise<Outcome>;
}

/** What was sent: the message's ts, if there was text, and the copies of the files. */
interface Sent extends Copies {
  ts?: string;
}

export function createSender({ config, store, i18n, notices }: Deps): Sender {
  // The records go in the team channel, so in the team's language.
  const t = i18n.team;

  const postText = async (client: WebClient, channel: string, message: RichTextBlock) =>
    (await client.chat.postMessage({ channel, text: plainText(message), blocks: [message] })).ts;

  /**
   * Posts in a channel. The bot uploads files into channels it is in; into a public one it isn't in, it can only show
   * images, in the message itself.
   */
  async function sendToChannel(client: WebClient, channel: string, { message, files }: Post): Promise<Sent> {
    const { channel: info } = await client.conversations.info({ channel });
    if (files.length === 0 || info?.is_member !== false) {
      const ts = message ? await postText(client, channel, message) : undefined;
      const copies = files.length > 0 ? await uploadCopies(client, files, { channel }) : { fileIds: [], problems: [] };
      return { ts, ...copies };
    }
    const images = files.filter(isImage);
    const others = files.filter((f) => !isImage(f));
    const sent: Sent = { fileIds: [], problems: others.map((f) => ({ name: fileName(f), problem: 'needsMember' })) };
    if (images.length > 0) {
      const text = message ? plainText(message) : images.map(fileName).join(', ');
      const shown = await showImages(client, images, async (blocks) => {
        const all: KnownBlock[] = [...(message ? [message] : []), ...blocks];
        return (await client.chat.postMessage({ channel, text, blocks: all })).ts;
      });
      Object.assign(sent, { ts: shown.ts, fileIds: shown.fileIds, problems: [...sent.problems, ...shown.problems] });
    }
    if (!sent.ts && message) sent.ts = await postText(client, channel, message);
    return sent;
  }

  /** What the record says about the files: which were posted, by name (they aren't copied there), and which weren't. */
  function filesNote(post: Post, sent: Sent): KnownBlock[] {
    const posted = copiedNames(post.files, sent.problems);
    const list = posted.map(escapeMrkdwn).join(', ');
    const problems = describeProblems(t, sent.problems, 'team');
    return [
      ...(posted.length > 0 ? [context(t.files.included({ count: posted.length, list }))] : []),
      ...(sent.problems.length > 0 ? [context(t.files.notPosted({ list: problems }))] : []),
    ];
  }

  /** A link to what was posted; none if Slack can't give one, as the post is out anyway. */
  async function permalink(client: WebClient, channel: string, sent: Sent): Promise<string> {
    try {
      if (sent.ts) return (await client.chat.getPermalink({ channel, message_ts: sent.ts })).permalink ?? '';
      const { file } = await client.files.info({ file: sent.fileIds[0]! });
      return file?.permalink ?? '';
    } catch {
      return '';
    }
  }

  async function failed(client: WebClient, poster: string, target: string, error: unknown): Promise<Outcome> {
    await notices.post(client, { text: t.publish.record.failed({ poster, target, reason: describeError(t, error) }) });
    return { status: 'failed', error };
  }

  async function nothingSent(client: WebClient, poster: string, target: string, sent: Sent): Promise<Outcome> {
    const list = describeProblems(t, sent.problems, 'team');
    await notices.post(client, { text: t.publish.record.nothingPosted({ poster, target, list }) });
    return { status: 'nothing', problems: sent.problems };
  }

  return {
    async toChannel(client, poster, channel, post) {
      let sent: Sent;
      try {
        sent = await sendToChannel(client, channel, post);
      } catch (error) {
        return failed(client, poster, `<#${channel}>`, error);
      }
      if (!sent.ts && sent.fileIds.length === 0) return nothingSent(client, poster, `<#${channel}>`, sent);
      const link = await permalink(client, channel, sent);
      const header = link
        ? t.publish.record.posted({ poster, channel, permalink: link })
        : t.publish.record.postedNoLink({ poster, channel });
      const blocks = [...quoted(header, post.message ? [post.message] : []), ...filesNote(post, sent)];
      const recordTs = await notices.post(client, { text: header, blocks });
      if (recordTs) store.deliveries.record(recordTs, channel, sent.ts ?? null, poster, sent.fileIds);
      return { status: 'sent', permalink: link || undefined, problems: sent.problems };
    },

    async toPerson(client, poster, user, post) {
      let dm: string | undefined;
      try {
        dm = (await client.conversations.open({ users: user })).channel?.id;
        if (!dm) throw new Error('channel_not_found');
      } catch (error) {
        return failed(client, poster, `<@${user}>`, error);
      }
      const dmChannel = dm;

      return serialized(dmChannel, async (): Promise<Outcome> => {
        let sent: Sent;
        try {
          const ts = post.message ? await postText(client, dmChannel, post.message) : undefined;
          const copies = post.files.length > 0 ? await uploadCopies(client, post.files, { channel: dmChannel }) : undefined;
          sent = { ts, fileIds: copies?.fileIds ?? [], problems: copies?.problems ?? [] };
        } catch (error) {
          return failed(client, poster, `<@${user}>`, error);
        }
        if (!sent.ts && sent.fileIds.length === 0) return nothingSent(client, poster, `<@${user}>`, sent);

        const existing = store.conversations.latestDm(dmChannel, Date.now() - config.inboxIdleDays * DAY);
        const header = t.publish.record.dmStarted({ poster, user });
        const blocks = [...quoted(header, post.message ? [post.message] : []), ...filesNote(post, sent)];
        // In the person's ongoing conversation if there is one (and its thread still exists), else in a new one.
        let recordTs = existing && (await notices.post(client, { text: header, blocks, threadTs: existing.teamThreadTs }));
        if (existing && recordTs) {
          store.conversations.touch(existing.id);
        } else {
          const hint = context(t.inbox.thread.replyHint({ sendEmoji: config.sendEmoji }));
          recordTs = await notices.post(client, { text: header, blocks: [...blocks, hint] });
          if (recordTs) {
            store.conversations.create({ kind: 'dm', userId: user, targetChannel: dmChannel, targetThreadTs: null, teamThreadTs: recordTs });
          }
        }
        if (recordTs) store.deliveries.record(recordTs, dmChannel, sent.ts ?? null, poster, sent.fileIds);
        return { status: 'sent', problems: sent.problems };
      });
    },
  };
}
