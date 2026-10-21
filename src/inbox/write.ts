import type { App, BlockAction, ButtonAction, GlobalShortcut } from '@slack/bolt';
import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { WRITE_SHORTCUT } from '#src/manifest/index.ts';
import { context, modalTitle, spacer } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';
import { isBlank, richTextBlocks, richTextFromPlain } from '#src/slack/richtext.ts';
import type { Dms } from './dms.ts';

const plain = (text: string) => ({ type: 'plain_text' as const, text });

/** The form to write to the team with your name. */
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
      {
        type: 'input',
        block_id: 'message',
        label: plain(t.inbox.write.message),
        element: { type: 'rich_text_input', action_id: 'message', initial_value: message, focus_on_load: true },
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
    const [message] = richTextBlocks([view.state.values.message?.message?.rich_text_value]);
    if (!message || isBlank(message)) {
      await ack({ response_action: 'errors', errors: { message: t.inbox.write.empty } });
      return;
    }
    // Sent before acknowledging, so the person only sees "sent" once it is in the team channel.
    try {
      await dms.write(client, userId, message);
    } catch (error) {
      app.logger.error(`Writing to the team failed: ${errorCode(error)}`);
      await ack({ response_action: 'errors', errors: { message: t.inbox.write.sendFailed } });
      return;
    }
    const sent: ModalView = {
      type: 'modal',
      title: modalTitle(t.inbox.write.title),
      close: plain(t.common.close),
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: t.inbox.write.sent } }],
    };
    await ack({ response_action: 'update', view: sent });
  });
}
