import type { App } from '@slack/bolt';
import type { Anonymous } from '#src/anonymous/index.ts';
import type { Deps } from '#src/deps.ts';
import { registerChanges } from './changes.ts';
import { registerDms, type Dms } from './dms.ts';
import { registerMentions } from './mentions.ts';
import { createRelay } from './relay.ts';
import { registerReplies } from './replies.ts';
import { registerWrite } from './write.ts';

export type { Dms as Inbox } from './dms.ts';

/**
 * The inbox: people write to the bot by DM, from a form, or by @mention; each conversation is a thread in the team
 * channel, and the team answers from there with reactions.
 */
export function registerInbox(app: App, deps: Deps, anonymous: Anonymous): Dms {
  const relay = createRelay(deps);
  registerMentions(app, deps, relay);
  registerReplies(app, deps, anonymous);
  const dms = registerDms(app, deps, relay);
  registerChanges(app, deps);
  registerWrite(app, deps, dms);
  return dms;
}
