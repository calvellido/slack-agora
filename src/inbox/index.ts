import type { App } from '@slack/bolt';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { registerDms, type Dms } from './dms.ts';
import { registerMentions } from './mentions.ts';
import { createRelay } from './relay.ts';
import { registerReplies } from './replies.ts';

export type { Dms as Inbox } from './dms.ts';

/**
 * The inbox: people write to the bot by DM or @mention, each conversation is a thread in the team channel, and the
 * team answers from there with reactions.
 */
export function registerInbox(app: App, deps: Deps, anonymous: Anonymous): Dms {
  const relay = createRelay(deps);
  registerMentions(app, deps, relay);
  registerReplies(app, deps, anonymous);
  return registerDms(app, deps, relay);
}
