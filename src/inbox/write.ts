import type { App, BlockAction, ButtonAction, GlobalShortcut } from '@slack/bolt';
import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { WRITE_SHORTCUT } from '#src/manifest/index.ts';
import { context, modalTitle, spacer } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { MAX_FILE_MB, describeProblems, filesInForm, foreseenProblems } from '#src/slack/files.ts';
import { isBlank, richTextBlocks, richTextFromPlain } from '#src/slack/richtext.ts';
import type { Dms } from './dms.ts';

const plain = (text: string) => ({ type: 'plain_text' as const, text });

/** The form to write to the team with your name: a message, files, or both. */
export function writeView(t: Strings, message?: RichTextBlock): ModalView {
  return {
    type: 'modal',
    callback_id: 'write_message',
    title: modalTitle(t.inbox.write.title),
    submit: plain(t.inbox.write.submit),
    close: plain(t.common.cancel),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: t.inbox.write.intro } },
      spacer(),
      // Optional for Slack, so a message can be files alone: the submission checks there is something to send.
      {
        type: 'input',
        block_id: 'message',
        optional: true,
        label: plain(t.inbox.write.message),
        element: { type: 'rich_text_input', action_id: 'message', initial_value: message, focus_on_load: true },
      },
      {
        type: 'input',
        block_id: 'attachments',
        optional: true,
        label: plain(t.inbox.write.attachments),
        hint: plain(t.inbox.write.attachmentsHint({ max: MAX_FILE_MB })),
        element: { type: 'file_input', action_id: 'files', max_files: 10 },
      },
      spacer(),
      context(t.inbox.write.anonymousHint),
    ],
  };
}

/**
 * Writing to the team with your name from a form, opened from the command (with text, already filled in), the
 * shortcut or the Home tab. What is sent is relayed as a DM, so the conversation then goes on in the person's DM.
 */
export function registerWrite(app: App, { config, i18n }: Deps, dms: Dms): void {
  async function open(client: WebClient, triggerId: string, userId: string, text?: string) {
    const t = await i18n.forUser(userId);
    await client.views.open({ trigger_id: triggerId, view: writeView(t, text ? richTextFromPlain(text) : undefined) });
  }

  if (config.writeCommand) {
    app.command(config.writeCommand, async ({ ack, command, client }) => {
      await ack();
      await open(client, command.trigger_id, command.user_id, command.text.trim());
    });
  }

  // Registered even without the shortcut in the manifest, in case the app's settings still have it.
  app.shortcut<GlobalShortcut>({ callback_id: WRITE_SHORTCUT, type: 'shortcut' }, async ({ ack, shortcut, client }) => {
    await ack();
    await open(client, shortcut.trigger_id, shortcut.user.id);
  });

  app.action<BlockAction<ButtonAction>>('write_open', async ({ ack, body, client }) => {
    await ack();
    await open(client, body.trigger_id, body.user.id);
  });

  app.view('write_message', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const t = await i18n.forUser(userId);
    const [typed] = richTextBlocks([view.state.values.message?.message?.rich_text_value]);
    const message = typed && !isBlank(typed) ? typed : undefined;
    const files = filesInForm(view.state.values as never);
    if (!message && files.length === 0) {
      await ack({ response_action: 'errors', errors: { message: t.inbox.write.empty } });
      return;
    }
    // Files that won't go stop the form, so nothing is sent until they're removed.
    const problems = foreseenProblems(files);
    if (problems.length > 0) {
      const list = describeProblems(t, problems, 'person', 'plain');
      await ack({ response_action: 'errors', errors: { attachments: t.inbox.write.cantSend({ list }) } });
      return;
    }
    const notice = (text: string): ModalView => ({
      type: 'modal',
      title: modalTitle(t.inbox.write.title),
      close: plain(t.common.close),
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    });

    // A message alone is sent before acknowledging, so the person only sees "sent" once it is in the team channel.
    // Copying files can take longer than Slack waits for that, so with files the form says it is sending first.
    if (files.length === 0) {
      try {
        await dms.write(client, userId, { message, files });
      } catch (error) {
        app.logger.error(`Writing to the team failed: ${errorCode(error)}`);
        await ack({ response_action: 'errors', errors: { message: t.inbox.write.sendFailed } });
        return;
      }
      await ack({ response_action: 'update', view: notice(t.inbox.write.sent) });
      return;
    }
    await ack({ response_action: 'update', view: notice(t.inbox.write.sending) });
    let result: string;
    try {
      const problems = await dms.write(client, userId, { message, files });
      const missing = t.files.notReceived({ list: describeProblems(t, problems, 'person') });
      // Each file has at most one problem, so fewer problems than files means some arrived.
      const arrived = message || problems.length < files.length;
      result = problems.length === 0 ? t.inbox.write.sent : arrived ? `${t.inbox.write.sent}\n\n${missing}` : missing;
    } catch (error) {
      app.logger.error(`Writing to the team failed: ${errorCode(error)}`);
      result = t.inbox.write.sendFailed;
    }
    // The person may have closed the window meanwhile.
    await client.views.update({ view_id: view.id, view: notice(result) }).catch(() => {});
  });
}
