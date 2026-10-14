import type { App, MessageShortcut } from '@slack/bolt';
import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import { isBlank, plainText, richTextBlocks, richTextFromPlain } from './richtext.ts';
import type { Strings } from './i18n/index.ts';
import { PUBLISH_SHORTCUT } from './manifest.ts';
import { DAY, context, errorCode, modalTitle, postInThread, quoted, serialized, type Deps } from './slack.ts';

/** The publish command and message shortcut: post to a channel or DM people as the bot. */
export function registerPublish(app: App, { config, store, team, i18n }: Deps): void {
  const teamChannel = config.teamChannelId;
  const teamStrings = i18n.team;

  app.command(config.publishCommand, async ({ ack, command, client }) => {
    const t = await i18n.forUser(command.user_id);
    if (!(await team.isMember(command.user_id))) return ack(t.teamOnly);
    await ack();
    const here = command.channel_id;
    const text = command.text.trim();
    await client.views.open({
      trigger_id: command.trigger_id,
      view: publishView(t, {
        channel: /^[CG]/.test(here) && here !== teamChannel ? here : undefined,
        message: text ? richTextFromPlain(text) : undefined,
      }),
    });
  });

  app.shortcut<MessageShortcut>(
    { callback_id: PUBLISH_SHORTCUT, type: 'message_action' },
    async ({ ack, shortcut, client, respond }) => {
      await ack();
      const t = await i18n.forUser(shortcut.user.id);
      if (!(await team.isMember(shortcut.user.id))) {
        await respond({ response_type: 'ephemeral', text: t.teamOnly });
        return;
      }
      const [message] = richTextBlocks(shortcut.message.blocks);
      const text = shortcut.message.text;
      await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: publishView(t, { message: message ?? (text ? richTextFromPlain(text) : undefined) }),
      });
    },
  );

  app.view('publish', async ({ ack, body, view, client }) => {
    const poster = body.user.id;
    const t = await i18n.forUser(poster);
    const values = view.state.values;
    const channel = values.channel?.channel?.selected_conversation ?? undefined;
    const people = values.people?.people?.selected_users ?? [];
    const [message] = richTextBlocks([values.message?.message?.rich_text_value]);

    const errors: Record<string, string> = {};
    if (!(await team.isMember(poster))) errors.message = t.teamOnly;
    else if (isBlank(message)) errors.message = t.publishEmpty;
    if (!channel && people.length === 0) errors.channel = t.publishNeedTarget;
    else if (channel) {
      const problem = await channelProblem(client, channel, t);
      if (problem) errors.channel = problem;
    }
    if (Object.keys(errors).length > 0 || !message) {
      await ack({ response_action: 'errors', errors });
      return;
    }
    await ack();

    if (channel) await publishToChannel(client, poster, channel, message);
    for (const user of people) await writeToPerson(client, poster, user, message);
  });

  function publishView(t: Strings, initial: { channel?: string; message?: RichTextBlock }): ModalView {
    return {
      type: 'modal',
      callback_id: 'publish',
      title: modalTitle(t.publishTitle),
      submit: { type: 'plain_text', text: t.publishSubmit },
      close: { type: 'plain_text', text: t.publishClose },
      blocks: [
        {
          type: 'input',
          block_id: 'channel',
          optional: true,
          label: { type: 'plain_text', text: t.publishChannel },
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
          label: { type: 'plain_text', text: t.publishPeople },
          element: { type: 'multi_users_select', action_id: 'people', max_selected_items: 20 },
        },
        {
          type: 'input',
          block_id: 'message',
          label: { type: 'plain_text', text: t.publishMessage },
          element: { type: 'rich_text_input', action_id: 'message', initial_value: initial.message },
        },
        context(t.publishHint(teamChannel)),
      ],
    };
  }

  /** Why the bot can't post in this channel, if it can't. Public channels work thanks to chat:write.public. */
  async function channelProblem(client: WebClient, channel: string, t: Strings): Promise<string | undefined> {
    try {
      const { channel: info } = await client.conversations.info({ channel });
      if (info?.is_archived) return t.publishArchived;
      if (info?.is_private && !info.is_member) return t.publishNotMember;
      return undefined;
    } catch (error) {
      if (errorCode(error) === 'channel_not_found') return t.publishNotMember;
      throw error;
    }
  }

  async function publishToChannel(client: WebClient, poster: string, channel: string, message: RichTextBlock) {
    let sentTs: string | undefined;
    try {
      sentTs = (await client.chat.postMessage({ channel, text: plainText(message), blocks: [message] })).ts;
    } catch (error) {
      await client.chat.postMessage({
        channel: teamChannel,
        text: teamStrings.publishFailed(poster, `<#${channel}>`, errorCode(error)),
      });
      return;
    }
    if (!sentTs) return;
    const { permalink } = await client.chat.getPermalink({ channel, message_ts: sentTs });
    const header = teamStrings.published(poster, channel, permalink ?? '');
    const record = await client.chat.postMessage({
      channel: teamChannel,
      text: header,
      blocks: quoted(header, [message]),
      unfurl_links: false,
    });
    if (record.ts) store.recordDelivery(record.ts, channel, sentTs, poster);
  }

  /** DMs someone as the bot. Their answers land in the same team channel thread as the message. */
  async function writeToPerson(client: WebClient, poster: string, user: string, message: RichTextBlock) {
    let dm: string | undefined;
    try {
      dm = (await client.conversations.open({ users: user })).channel?.id;
    } catch (error) {
      await client.chat.postMessage({ channel: teamChannel, text: teamStrings.publishFailed(poster, `<@${user}>`, errorCode(error)) });
      return;
    }
    if (!dm) return;
    const dmChannel = dm;

    await serialized(dmChannel, async () => {
      let sentTs: string | undefined;
      try {
        sentTs = (await client.chat.postMessage({ channel: dmChannel, text: plainText(message), blocks: [message] })).ts;
      } catch (error) {
        await client.chat.postMessage({ channel: teamChannel, text: teamStrings.publishFailed(poster, `<@${user}>`, errorCode(error)) });
        return;
      }
      if (!sentTs) return;

      const existing = store.latestDm(dmChannel, Date.now() - config.inboxIdleDays * DAY);
      const header = teamStrings.dmStarted(poster, user);
      const post = { channel: teamChannel, text: header, blocks: quoted(header, [message]), unfurl_links: false };
      // In the person's ongoing conversation if there is one (and its thread still exists), else in a new one.
      let recordTs = existing && (await postInThread(client, { ...post, thread_ts: existing.teamThreadTs }));
      if (existing && recordTs) {
        store.touch(existing.id);
      } else {
        recordTs = (
          await client.chat.postMessage({ ...post, blocks: [...post.blocks, context(teamStrings.replyHint(config.sendEmoji))] })
        ).ts;
        if (!recordTs) return;
        store.createConversation({ kind: 'dm', userId: user, targetChannel: dmChannel, targetThreadTs: null, teamThreadTs: recordTs });
      }
      store.recordDelivery(recordTs, dmChannel, sentTs, poster);
    });
  }
}
