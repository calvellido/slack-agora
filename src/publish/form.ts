import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Strings } from '#src/i18n/index.ts';
import { context, modalTitle } from '#src/slack/blocks.ts';
import { describeError, errorCode } from '#src/slack/errors.ts';
import { MAX_FILE_MB, describeProblems, foreseenProblems, type AttachedFile } from '#src/slack/files.ts';
import type { Outcome } from './send.ts';

const plain = (text: string) => ({ type: 'plain_text' as const, text });

/**
 * The form to post as the bot: a channel, people to DM, or both, the message, and files to attach. `original` are the
 * files of the message it started from, all ticked, to untick any that shouldn't go. Either files or a message do.
 */
export function publishView(
  t: Strings,
  teamChannel: string,
  initial: { channel?: string; message?: RichTextBlock; original?: { id: string; name: string }[] },
): ModalView {
  // Slack allows ten checkboxes, each up to 75 characters.
  const options = (initial.original ?? []).slice(0, 10).map(({ id, name }) => ({
    text: { type: 'plain_text' as const, text: name.length > 75 ? `${name.slice(0, 74)}…` : name },
    value: id,
  }));
  return {
    type: 'modal',
    callback_id: 'publish',
    title: modalTitle(t.publish.form.title),
    submit: { type: 'plain_text', text: t.publish.form.submit },
    close: { type: 'plain_text', text: t.publish.form.close },
    blocks: [
      {
        type: 'input',
        block_id: 'channel',
        optional: true,
        label: { type: 'plain_text', text: t.publish.form.channel },
        element: {
          type: 'conversations_select',
          action_id: 'channel',
          filter: { include: ['public', 'private'] },
          initial_conversation: initial.channel,
        },
      },
      {
        type: 'input',
        block_id: 'people',
        optional: true,
        label: { type: 'plain_text', text: t.publish.form.people },
        element: { type: 'multi_users_select', action_id: 'people', max_selected_items: 20 },
      },
      // Optional for Slack, so a post can be files alone: the submission checks there is something to post.
      {
        type: 'input',
        block_id: 'message',
        optional: true,
        label: { type: 'plain_text', text: t.publish.form.message },
        element: { type: 'rich_text_input', action_id: 'message', initial_value: initial.message },
      },
      ...(options.length > 0
        ? [
            {
              type: 'input' as const,
              block_id: 'original',
              optional: true,
              label: { type: 'plain_text' as const, text: t.publish.form.originalFiles },
              element: { type: 'checkboxes' as const, action_id: 'files', options, initial_options: options },
            },
          ]
        : []),
      {
        type: 'input',
        block_id: 'attachments',
        optional: true,
        label: { type: 'plain_text', text: t.publish.form.attachments },
        hint: { type: 'plain_text', text: t.publish.form.attachmentsHint({ max: MAX_FILE_MB }) },
        element: { type: 'file_input', action_id: 'files', max_files: 10 },
      },
      context(t.publish.form.hint({ teamChannel })),
    ],
  };
}

/** The IDs of the files from the original message left ticked. */
export function originalInForm(
  values: Record<string, Record<string, { selected_options?: { value: string }[] }>>,
): string[] {
  return (values.original?.files?.selected_options ?? []).map((o) => o.value);
}

/**
 * Why the bot can't post in this channel, if it can't, and whether it is in it. Public channels work without it,
 * thanks to chat:write.public, but then only for text and images.
 */
export async function checkChannel(
  client: WebClient,
  channel: string,
  t: Strings,
): Promise<{ problem?: string; member: boolean }> {
  try {
    const { channel: info } = await client.conversations.info({ channel });
    if (info?.is_archived) return { problem: t.publish.form.archived, member: Boolean(info.is_member) };
    if (info?.is_private && !info.is_member) return { problem: t.publish.form.notMember, member: false };
    return { member: Boolean(info?.is_member) };
  } catch (error) {
    if (errorCode(error) === 'channel_not_found') return { problem: t.publish.form.notMember, member: false };
    throw error;
  }
}

/**
 * The form's errors for files that wouldn't be posted, foreseen from their descriptions, so nothing is sent until
 * they are removed: too large, impossible to download, or other than images for a public channel the bot isn't in.
 */
export function fileErrors(
  t: Strings,
  files: { attached: readonly AttachedFile[]; original: readonly AttachedFile[] },
  imagesOnly: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [block, group] of [['attachments', files.attached], ['original', files.original]] as const) {
    const problems = foreseenProblems(group, imagesOnly);
    const list = describeProblems(t, problems, 'team', 'plain');
    if (problems.length > 0) errors[block] = t.publish.form.cantPost({ list });
  }
  return errors;
}

/** The form once sent: what it is doing, or how it went, with small print under it. */
export function doneView(t: Strings, text: string, extra: string[] = []): ModalView {
  return {
    type: 'modal',
    title: modalTitle(t.publish.form.title),
    close: plain(t.common.close),
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }, ...extra.map(context)],
  };
}

/** How it went for each target (a channel or a person, as a mention), and, if anything went, how to delete it. */
export function resultView(
  t: Strings,
  results: { target: string; outcome: Outcome }[],
  record: { teamChannel: string; deleteEmoji: string },
): ModalView {
  const lines = results.map(({ target, outcome }) => {
    if (outcome.status === 'failed') return t.publish.done.failed({ target, reason: describeError(t, outcome.error) });
    const problems = describeProblems(t, outcome.problems, 'team');
    if (outcome.status === 'nothing') return t.publish.done.nothing({ target, list: problems });
    const done = outcome.permalink ? t.publish.done.posted({ target, permalink: outcome.permalink }) : t.publish.done.sent({ target });
    return outcome.problems.length > 0 ? `${done}\n${t.files.notPosted({ list: problems })}` : done;
  });
  const sent = results.some((r) => r.outcome.status === 'sent');
  return doneView(t, lines.join('\n\n'), sent ? [t.publish.done.record(record)] : []);
}
