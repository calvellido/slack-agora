import type { Activity } from './activity.ts';
import type { ContentKeys } from './anonymous/content.ts';
import type { Config } from './config.ts';
import type { I18n } from './i18n/index.ts';
import type { BotIdentity } from './slack/identity.ts';
import type { Notices } from './slack/notices.ts';
import type { TeamDirectory } from './slack/team-directory.ts';
import type { Store } from './storage/index.ts';

/** The shared services every feature receives when it registers its handlers (see main.ts). */
export interface Deps {
  config: Config;
  store: Store;
  team: TeamDirectory;
  /** Keyed hash identifying the author of anonymous conversations (see anonymous/keys.ts). */
  anonOwner: (userId: string) => string;
  /** The keys of anonymous conversations' encrypted text (see anonymous/content.ts). */
  anonContent: ContentKeys;
  bot: BotIdentity;
  i18n: I18n;
  /** Posts what happened in the team channel, apart from the team's messages. */
  notices: Notices;
  /** What the bot has done since it started, for the console's status. */
  activity: Activity;
}
