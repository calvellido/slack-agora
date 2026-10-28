import type { App, BlockAction, ButtonAction, GlobalShortcut, ViewSubmitAction } from '@slack/bolt';
import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { WRITE_SHORTCUT } from '#src/manifest/index.ts';
import { context, modalTitle, spacer } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { MAX_FILE_MB, describeProblems, filesInForm, foreseenProblems } from '#src/slack/files.ts';
import { SEND_WAIT_MS, answerInTime, type Answer } from '#src/slack/forms.ts';
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
export function registerWrite(app: App, { config, i18n }: Deps, dms: Dms, sendWaitMs = SEND_WAIT_MS): void {
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

  app.view<ViewSubmitAction>('write_message', async ({ ack, body, view, client }) => {
    const received = Date.now();
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

    const answering = dms.write(client, userId, { message, files }).then(
      (problems): Answer => {
        const missing = t.files.notReceived({ list: describeProblems(t, problems, 'person') });
        // Each file has at most one problem, so fewer problems than files means some arrived.
        const arrived = message || problems.length < files.length;
        const result = problems.length === 0 ? t.inbox.write.sent : arrived ? `${t.inbox.write.sent}\n\n${missing}` : missing;
        return { response_action: 'update', view: notice(result) };
      },
      (error: unknown): Answer => {
        app.logger.error(`Writing to the team failed: ${errorCode(error)}`);
        return { response_action: 'errors', errors: { message: t.inbox.write.sendFailed } };
      },
    );

    // A message alone is usually in the team channel within moments, so the form waits for it: the person sees "sent"
    // once it is there, or the error with their message still in the form. Copying files takes longer than Slack waits
    // for the answer, so with files the form says at once that it is sending, and how it went after.
    const sending = t.inbox.write.sending({ files: files.length > 0 ? 'yes' : 'no' });
    const late = { notice, sending, done: t.inbox.write.sent, failed: t.inbox.write.sendFailed };
    const form = { ack, client, viewId: view.id, received };
    await answerInTime(form, answering, late, files.length > 0 ? 0 : sendWaitMs);
  });
}
