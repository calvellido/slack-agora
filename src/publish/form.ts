import type { ModalView, RichTextBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Strings } from '#src/i18n/index.ts';
import { context, modalTitle } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';

/** The form to post as the bot: a channel, people to DM, or both, and the message. */
export function publishView(
  t: Strings,
  teamChannel: string,
  initial: { channel?: string; message?: RichTextBlock },
): ModalView {
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
export async function channelProblem(client: WebClient, channel: string, t: Strings): Promise<string | undefined> {
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
