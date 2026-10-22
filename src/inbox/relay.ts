import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { context, quoted, slackDate } from '#src/slack/blocks.ts';
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

/** What the relay did: the thread it started, if it started one, and the files it couldn't copy. */
export interface Relayed {
  started?: string;
  problems: Copies['problems'];
}

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
   * is told to the team, and returned.
   */
  async function copyFiles(client: WebClient, threadTs: string, message: Incoming): Promise<Copies['problems']> {
    const images = message.files.filter(isImage);
    const others = message.files.filter((f) => !isImage(f));
    const problems: Copies['problems'] = [];
    if (images.length > 0) {
      const line = t.files.attached({ user: message.user });
      const shown = await showImages(client, images, (blocks) =>
        notices.post(client, { text: line, threadTs, blocks: [context(line), ...blocks] }),
      );
      problems.push(...shown.problems);
    }
    if (others.length > 0) {
      const person = await displayName(client, message.user);
      const options = {
        header: relayLine(message.user),
        title: (file: AttachedFile) => t.files.relayedTitle({ name: fileName(file), person }),
      };
      const uploaded = await uploadCopies(client, others, { channel: config.teamChannelId, threadTs }, options);
      problems.push(...uploaded.problems);
    }
    if (problems.length > 0) {
      await notices.post(client, { text: t.files.notRelayed({ list: describeProblems(t, problems, 'team') }), threadTs });
    }
    return problems;
  }

  return async (client, existing, header, message) => {
    const body = (title: string) => {
      const blocks = quoted(title, richTextBlocks(message.blocks), message.text);
      if (message.lateTs) blocks.push(context(t.inbox.thread.lateRelay({ date: slackDate(message.lateTs) })));
      return { text: `${title} ${message.text}`, blocks };
    };

    // Relayed by the bot on its own, so under the notices sender; the message keeps its full layout.
    let threadTs: string | undefined;
    let started: string | undefined;
    if (existing) {
      const followUp = body(t.inbox.thread.followUp({ user: message.user }));
      if (await notices.post(client, { ...followUp, threadTs: existing.teamThreadTs })) {
        store.conversations.touch(existing.id);
        threadTs = existing.teamThreadTs;
      }
    }
    if (!threadTs) {
      const { text, blocks } = body(await header());
      blocks.push(context(t.inbox.thread.replyHint({ sendEmoji: config.sendEmoji })));
      threadTs = started = await notices.post(client, { text, blocks });
    }
    const problems = threadTs && message.files.length > 0 ? await copyFiles(client, threadTs, message) : [];
    return { started, problems };
  };
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
