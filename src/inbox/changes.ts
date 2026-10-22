import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import { context, messageBody } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { deleteCopiesAndMessages } from '#src/slack/files.ts';
import { fetchMessage } from '#src/slack/messages.ts';
import { richTextBlocks } from '#src/slack/richtext.ts';
import type { RelayedDm } from '#src/storage/index.ts';
import { RECEIVED_EMOJI } from './downtime.ts';
import { withBody } from './relay.ts';

/** A DM as these events describe it, before or after the change. */
interface Described {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  blocks?: unknown[];
  edited?: unknown;
  reactions?: { name?: string; users?: string[] }[];
}

/**
 * Edits and deletions of DMs to the bot: the team's copy follows them, and the person is told, once per message and
 * kind of change. A DM whose copy can't be changed (relayed by an earlier version, which kept no record of it, or when
 * Slack refuses) stays as the team got it, which the person is told instead. DMs without the received mark never
 * reached the team, so nothing is said about them.
 */
export function registerChanges(app: App, { store, i18n, bot, notices }: Deps): void {
  const told = new Set<string>();
  async function tell(client: WebClient, channel: string, user: string, key: string, text: (t: Strings) => string) {
    if (told.has(key)) return;
    told.add(key);
    setTimeout(() => told.delete(key), DAY).unref();
    const t = await i18n.forUser(user);
    await notices.toPerson(client, { channel, text: text(t), username: t.notices.sender });
  }

  const fromPerson = (m: Described): m is Described & { user: string; ts: string } =>
    Boolean(m.user && m.ts && !m.bot_id && m.user !== bot.userId);
  const received = (m: Described) => m.reactions?.some((r) => r.name === RECEIVED_EMOJI && r.users?.includes(bot.userId));

  /** Puts the edited text in the copy. False if the team deleted the copy. */
  async function editCopy(client: WebClient, copy: RelayedDm, edited: Described): Promise<boolean> {
    const message = await fetchMessage(client, copy.teamChannel, copy.teamTs);
    if (!message?.blocks) return false;
    const body = messageBody(richTextBlocks(edited.blocks), edited.text ?? '');
    const { blocks, text } = withBody(message.blocks, body, edited.text ?? '');
    await client.chat.update({ channel: copy.teamChannel, ts: copy.teamTs, text, blocks });
    return true;
  }

  /** Takes the text out of the copy, saying the person deleted it, and deletes the copies of its files. */
  async function deleteCopy(client: WebClient, copy: RelayedDm, user: string): Promise<void> {
    const message = await fetchMessage(client, copy.teamChannel, copy.teamTs);
    if (message?.blocks) {
      const deleted = i18n.team.inbox.thread.deletedByPerson({ user });
      const { blocks, text } = withBody(message.blocks, [context(deleted)], deleted);
      await client.chat.update({ channel: copy.teamChannel, ts: copy.teamTs, text, blocks });
    }
    if (copy.noticeTs) {
      await client.chat.delete({ channel: copy.teamChannel, ts: copy.noticeTs }).catch((error: unknown) => {
        if (errorCode(error) !== 'message_not_found') throw error;
      });
    }
    await deleteCopiesAndMessages(client, copy.teamChannel, copy.fileIds);
  }

  app.event('message', async ({ event, client }) => {
    if (event.channel_type !== 'im') return;
    const { channel } = event;

    if (event.subtype === 'message_changed') {
      const before = event.previous_message as Described;
      const after = event.message as Described;
      // Slack also changes messages on its own, to add link previews: those aren't edited, nor is their text.
      if (!fromPerson(after) || !after.edited || after.text === before.text) return;
      const key = `edited:${channel}:${after.ts}`;
      const copy = store.relays.get(channel, after.ts);
      if (copy) {
        try {
          if (await editCopy(client, copy, after)) await tell(client, channel, after.user, key, (t) => t.inbox.dm.editForwarded);
          return;
        } catch (error) {
          app.logger.error(`Editing the copy of a DM failed: ${errorCode(error)}`);
        }
      } else if (!received(after) && !received(before)) {
        return;
      }
      await tell(client, channel, after.user, key, (t) => t.inbox.dm.edited);
    }

    if (event.subtype === 'message_deleted') {
      const before = { ...(event.previous_message as Described), ts: event.deleted_ts };
      if (!fromPerson(before)) return;
      const key = `deleted:${channel}:${before.ts}`;
      const copy = store.relays.get(channel, before.ts);
      if (copy) {
        try {
          await deleteCopy(client, copy, before.user);
          store.relays.remove(channel, before.ts);
          await tell(client, channel, before.user, key, (t) => t.inbox.dm.deletedForTeam);
          return;
        } catch (error) {
          app.logger.error(`Deleting the copy of a DM failed: ${errorCode(error)}`);
        }
      } else if (!received(before)) {
        return;
      }
      await tell(client, channel, before.user, key, (t) => t.inbox.dm.deleted);
    }
  });
}
