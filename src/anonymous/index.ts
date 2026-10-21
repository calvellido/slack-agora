import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import type { SlackMessage } from '#src/slack/messages.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import { registerTeamSide } from './team.ts';
import { createThread } from './thread.ts';
import { registerWindow } from './window.ts';

/** What the inbox and the startup need from anonymous mode. */
export interface Anonymous {
  /** Handles the send emoji on a reply in an anonymous thread. */
  sendReply(
    client: WebClient,
    conversation: AnonConversation,
    ts: string,
    message: SlackMessage,
    user: string,
    notify: (text: string) => Promise<void>,
  ): Promise<void>;
  /** Handles the delete emoji on a reply to an anonymous conversation; false if it isn't one. */
  deleteReply(client: WebClient, ts: string, user: string): Promise<boolean>;
  /** Ends idle conversations and forgets the authors of conversations ended long enough ago. */
  cleanup(client: WebClient): Promise<void>;
}

/**
 * Anonymous mode. People write through modals, never a DM, so nothing stays in their message history, and their
 * conversations only show in the "Anonymous messages" window, never on the Home tab. Their messages land in the team
 * channel with no name or code. Only a keyed hash of the author is stored (see keys.ts), until the conversation is
 * purged.
 *
 * - window.ts: the author's side, in their language.
 * - team.ts: the team's side, in the team channel.
 * - thread.ts: what the bot posts in the team channel for both.
 * - views.ts: the Block Kit views.
 */
export function registerAnonymous(app: App, deps: Deps): Anonymous {
  const thread = createThread(app, deps);
  registerWindow(app, deps, thread);
  return registerTeamSide(app, deps, thread);
}
