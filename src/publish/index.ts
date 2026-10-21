import type { App, BlockAction, ButtonAction, MessageShortcut } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import { PUBLISH_SHORTCUT } from '#src/manifest/index.ts';
import { isBlank, richTextBlocks, richTextFromPlain } from '#src/slack/richtext.ts';
import { channelProblem, publishView } from './form.ts';
import { createSender } from './send.ts';

/**
 * Posting as the bot: the publish command, the message shortcut and the button on the team's part of the Home tab open
 * the form; sending it posts and DMs as the bot.
 */
export function registerPublish(app: App, deps: Deps): void {
  const { config, team, i18n } = deps;
  const teamChannel = config.teamChannelId;
  const send = createSender(deps);

  app.command(config.publishCommand, async ({ ack, command, client }) => {
    const t = await i18n.forUser(command.user_id);
    if (!(await team.isMember(command.user_id))) return ack(t.publish.teamOnly);
    await ack();
    const here = command.channel_id;
    const text = command.text.trim();
    await client.views.open({
      trigger_id: command.trigger_id,
      view: publishView(t, teamChannel, {
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
        await respond({ response_type: 'ephemeral', text: t.publish.teamOnly });
        return;
      }
      const [message] = richTextBlocks(shortcut.message.blocks);
      const text = shortcut.message.text;
      await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: publishView(t, teamChannel, { message: message ?? (text ? richTextFromPlain(text) : undefined) }),
      });
    },
  );

  // Whoever sends the form is checked again, in case they left the team since their Home tab was published.
  app.action<BlockAction<ButtonAction>>('publish_open', async ({ ack, body, client }) => {
    await ack();
    const t = await i18n.forUser(body.user.id);
    await client.views.open({ trigger_id: body.trigger_id, view: publishView(t, teamChannel, {}) });
  });

  app.view('publish', async ({ ack, body, view, client }) => {
    const poster = body.user.id;
    const t = await i18n.forUser(poster);
    const values = view.state.values;
    const channel = values.channel?.channel?.selected_conversation ?? undefined;
    const people = values.people?.people?.selected_users ?? [];
    const [message] = richTextBlocks([values.message?.message?.rich_text_value]);

    const errors: Record<string, string> = {};
    if (!(await team.isMember(poster))) errors.message = t.publish.teamOnly;
    else if (isBlank(message)) errors.message = t.publish.form.empty;
    if (!channel && people.length === 0) errors.channel = t.publish.form.needTarget;
    else if (channel) {
      const problem = await channelProblem(client, channel, t);
      if (problem) errors.channel = problem;
    }
    if (Object.keys(errors).length > 0 || !message) {
      await ack({ response_action: 'errors', errors });
      return;
    }
    await ack();

    if (channel) await send.toChannel(client, poster, channel, message);
    for (const user of people) await send.toPerson(client, poster, user, message);
  });
}
