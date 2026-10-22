import type { App, BlockAction, ButtonAction, MessageShortcut } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import { PUBLISH_SHORTCUT } from '#src/manifest/index.ts';
import { errorCode } from '#src/slack/errors.ts';
import { filesById, filesInForm } from '#src/slack/files.ts';
import { isBlank, richTextBlocks, richTextFromPlain } from '#src/slack/richtext.ts';
import { checkChannel, doneView, fileErrors, originalInForm, publishView, resultView } from './form.ts';
import { createSender, type Outcome } from './send.ts';

/**
 * Posting as the bot: the publish command, the message shortcut and the button on the team's part of the Home tab open
 * the form; sending it posts and DMs as the bot.
 */
export function registerPublish(app: App, deps: Deps): void {
  const { config, team, i18n } = deps;
  const teamChannel = config.teamChannelId;
  const send = createSender(deps);

  if (config.publishCommand) {
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
  }

  // Registered even without the shortcut in the manifest, in case the app's settings still have it.
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
      const original = ((shortcut.message.files ?? []) as { id?: string; name?: string }[]).flatMap((f) =>
        f.id ? [{ id: f.id, name: f.name || f.id }] : [],
      );
      await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: publishView(t, teamChannel, {
          message: message ?? (text ? richTextFromPlain(text) : undefined),
          original,
        }),
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
    const originalIds = originalInForm(values as never);
    const attached = filesInForm(values as never);

    const errors: Record<string, string> = {};
    if (!(await team.isMember(poster))) errors.message = t.publish.teamOnly;
    else if (isBlank(message) && originalIds.length + attached.length === 0) errors.message = t.publish.form.empty;
    let imagesOnly = false;
    if (!channel && people.length === 0) errors.channel = t.publish.form.needTarget;
    else if (channel) {
      const check = await checkChannel(client, channel, t);
      if (check.problem) errors.channel = check.problem;
      imagesOnly = !check.member;
    }
    const original = originalIds.length > 0 ? await filesById(client, originalIds) : [];
    Object.assign(errors, fileErrors(t, { attached, original }, imagesOnly));
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }
    // Posting, files above all, can take longer than Slack waits for an answer: the form says how it went after.
    await ack({ response_action: 'update', view: doneView(t, t.publish.done.sending) });

    const post = { message: isBlank(message) ? undefined : message, files: [...original, ...attached] };
    const attempt = async (target: string, sending: () => Promise<Outcome>) => {
      try {
        return { target, outcome: await sending() };
      } catch (error) {
        app.logger.error(`Posting as the bot failed: ${errorCode(error)}`);
        return { target, outcome: { status: 'failed', error } as const };
      }
    };
    const results: { target: string; outcome: Outcome }[] = [];
    if (channel) results.push(await attempt(`<#${channel}>`, () => send.toChannel(client, poster, channel, post)));
    for (const user of people) results.push(await attempt(`<@${user}>`, () => send.toPerson(client, poster, user, post)));
    const done = resultView(t, results, { teamChannel, deleteEmoji: config.deleteEmoji });
    // Whoever posted may have closed the form meanwhile.
    await client.views.update({ view_id: view.id, view: done }).catch(() => {});
  });
}
