import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { onceFor } from '#src/lib/once.ts';
import { serialized } from '#src/lib/serialized.ts';
import { DAY } from '#src/lib/time.ts';
import { context, messageBody } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { deleteCopiesAndMessages } from '#src/slack/files.ts';
import { fetchMessage } from '#src/slack/messages.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';
import type { RelayedDm } from '#src/storage/index.ts';
import { tellPerson } from './dms.ts';
import { RECEIVED_EMOJI } from './downtime.ts';
import { withBody } from './relay.ts';

/** A DM as these events describe it, before or after the change. */
interface Described {
  ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  blocks?: unknown[];
  edited?: unknown;
  reactions?: { name?: string; users?: string[] }[];
}

/** What the person is told about a change: each of these once per message. */
type Note = 'editForwarded' | 'editFailed' | 'editGone' | 'edited' | 'deletedForTeam' | 'deletedPartly' | 'deleted';

/**
 * Edits and deletions of DMs to the bot: the team's copy follows them, and the person is told how it went. A DM
 * relayed by an earlier version, which kept no record of its copy, stays as the team got it, which the person is told
 * instead. DMs without the received mark never reached the team, so nothing is said about them.
 *
 * Changes wait for the DM's own relay, which records its copy (see dms.ts), and are made one after another, so a
 * quick edit and deletion land in the order they were made.
 */
export function registerChanges(app: App, deps: Deps): void {
  const { store, i18n, bot } = deps;
  const tell = tellPerson(deps);
  const firstTime = onceFor(DAY);
  async function note(client: WebClient, channel: string, ts: string, user: string, which: Note) {
    if (firstTime(`${which}:${channel}:${ts}`)) await tell(client, channel, user, (t) => t.inbox.dm[which]);
  }

  const fromPerson = (m: Described): m is Described & { user: string; ts: string } =>
    Boolean(m.user && m.ts && !m.bot_id && m.user !== bot.userId);
  const received = (m: Described) => m.reactions?.some((r) => r.name === RECEIVED_EMOJI && r.users?.includes(bot.userId));

  /** Puts the edited text in the copy, unless the team deleted the copy. */
  async function editCopy(client: WebClient, copy: RelayedDm, edited: Described): Promise<'edited' | 'gone'> {
    const message = await fetchMessage(client, copy.teamChannel, copy.teamTs);
    if (!message?.blocks) return 'gone';
    const body = messageBody(richTextBlocks(edited.blocks), edited.text ?? '');
    const { blocks, text } = withBody(message.blocks, body, edited.text ?? '');
    await client.chat.update({ channel: copy.teamChannel, ts: copy.teamTs, text, blocks });
    return 'edited';
  }

  async function edited(client: WebClient, channel: string, before: Described, after: Described & { user: string; ts: string }) {
    const copy = store.relays.get(channel, after.ts);
    if (!copy) {
      if (received(after) || received(before)) await note(client, channel, after.ts, after.user, 'edited');
      return;
    }
    let result: 'edited' | 'gone' | 'failed';
    try {
      result = await editCopy(client, copy, after);
    } catch (error) {
      app.logger.error(`Editing the copy of a DM failed: ${errorCode(error)}`);
      result = 'failed';
    }
    const which = ({ edited: 'editForwarded', gone: 'editGone', failed: 'editFailed' } as const)[result];
    await note(client, channel, after.ts, after.user, which);
  }

  /**
   * Takes the text out of the copy, saying the person deleted it, and deletes its notices and the copies of its files,
   * each on its own, so one failure doesn't leave the rest. Says whether the text went, and everything else with it.
   */
  async function deleteCopy(client: WebClient, copy: RelayedDm, user: string | undefined): Promise<'deleted' | 'partly' | 'kept'> {
    const failed = (error: unknown) => app.logger.error(`Deleting the copy of a DM failed: ${errorCode(error)}`);
    let textGone = true;
    let leftovers = false;
    try {
      const message = await fetchMessage(client, copy.teamChannel, copy.teamTs);
      if (message?.blocks) {
        const deleted = user ? i18n.team.inbox.thread.deletedByPerson({ user }) : i18n.team.inbox.thread.deletedByAuthor;
        const { blocks, text } = withBody(message.blocks, [context(deleted)], deleted);
        await client.chat.update({ channel: copy.teamChannel, ts: copy.teamTs, text, blocks });
      }
    } catch (error) {
      failed(error);
      textGone = false;
    }
    for (const ts of [copy.noticeTs, copy.problemsTs]) {
      if (!ts) continue;
      try {
        await client.chat.delete({ channel: copy.teamChannel, ts });
      } catch (error) {
        if (errorCode(error) === 'message_not_found') continue;
        failed(error);
        leftovers = true;
      }
    }
    try {
      await deleteCopiesAndMessages(client, copy.teamChannel, copy.fileIds);
    } catch (error) {
      failed(error);
      leftovers = true;
    }
    return !textGone ? 'kept' : leftovers ? 'partly' : 'deleted';
  }

  async function deleted(client: WebClient, channel: string, ts: string | undefined, before: Described) {
    if (!ts) return;
    const copy = store.relays.get(channel, ts);
    if (!copy) {
      if (fromPerson(before) && received(before)) await note(client, channel, ts, before.user, 'deleted');
      return;
    }
    // Only people's DMs have a record, so it is enough, but Slack doesn't always say whose the message was.
    const user = before.user ?? store.conversations.latestDm(channel, 0)?.userId;
    const result = await deleteCopy(client, copy, user);
    // The DM is gone, so nothing could try again.
    store.relays.remove(channel, ts);
    const which = ({ deleted: 'deletedForTeam', partly: 'deletedPartly', kept: 'deleted' } as const)[result];
    if (user) await note(client, channel, ts, user, which);
  }

  app.event('message', async ({ event, client }) => {
    if (event.channel_type !== 'im') return;
    const { channel } = event;

    if (event.subtype === 'message_changed') {
      const before = (event.previous_message ?? {}) as Described;
      const after = event.message as Described;
      // A DM deleted while it has replies in its thread stays as a placeholder, which comes as a change.
      if (after.subtype === 'tombstone') return serialized(channel, () => deleted(client, channel, after.ts ?? before.ts, before));
      // Slack also changes messages on its own, to add link previews: those aren't edited, nor is their text.
      if (!fromPerson(after) || !after.edited || after.text === before.text) return;
      return serialized(channel, () => edited(client, channel, before, after));
    }

    if (event.subtype === 'message_deleted') {
      const before = (event.previous_message ?? {}) as Described;
      return serialized(channel, () => deleted(client, channel, event.deleted_ts, before));
    }
  });
}
