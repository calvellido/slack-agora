import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { StatusInfo } from '#src/console/status.ts';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { VERSION } from '#src/lib/version.ts';
import { errorCode } from '#src/slack/errors.ts';
import type { Person } from '#src/slack/team-directory.ts';
import { registerStatus } from './status.ts';
import { canCheckForUpdates, registerUpdateCheck } from './updates.ts';
import { homeView, type HomeOptions } from './view.ts';

/**
 * How long the tab says the bot is online after publishing it, before saying that opening it checks. The bot can't
 * change the tab once it is down, so it doesn't leave it saying it is online for long.
 */
export const ONLINE_FOR_MS = 60_000;

/**
 * The bot's Home tab, published again every time someone opens it, in their language, and its team's buttons. On a
 * clean stop, `stop` turns the tabs still saying the bot is online into saying that opening them checks.
 */
export function registerHome(
  app: App,
  { config, team, bot, i18n, activity }: Deps,
  status: () => StatusInfo,
  onlineForMs = ONLINE_FOR_MS,
): { stop(): Promise<void> } {
  registerStatus(app, { team, i18n, activity }, status);
  registerUpdateCheck(app, { config, team, i18n });

  // Without the list, the tab still opens: Slack may be slow or the channel unreadable for a moment.
  async function teamPeople(): Promise<Person[] | undefined> {
    try {
      return await team.people();
    } catch (error) {
      app.logger.warn(`Couldn't list the team channel's people for the Home tab: ${errorCode(error)}`);
      return undefined;
    }
  }

  /** Publishes the tab, without the banner if Slack can't fetch it, and returns the options it used. */
  async function publish(client: WebClient, user: string, t: Strings, options: HomeOptions): Promise<HomeOptions> {
    try {
      await client.views.publish({ user_id: user, view: homeView(t, options) });
      return options;
    } catch (error) {
      if (!options.banner) throw error;
      // Slack refuses the whole tab when it can't fetch an image, so it goes without the banner.
      app.logger.warn(`Slack couldn't show HOME_BANNER_URL (${errorCode(error)}): the Home tab goes without it`);
      const without = { ...options, banner: undefined };
      await client.views.publish({ user_id: user, view: homeView(t, without) });
      return without;
    }
  }

  // The people whose tab says the bot is online, until it says opening it checks: only in memory, and only for that
  // minute, since a list of who opens the bot's tab would say who might write to the team.
  const online = new Map<string, { timer: NodeJS.Timeout; settle: () => Promise<void> }>();

  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;
    const language = await i18n.language(event.user);
    const t = i18n.in(language);
    const options: HomeOptions = {
      bot,
      members: config.homeTeamMembers ? await teamPeople() : undefined,
      about: config.about[language] ?? config.about.default,
      banner: config.homeBanner,
      writeCommand: config.writeCommand,
      sourceUrl: config.sourceUrl,
      version: VERSION,
      online: Date.now(),
      team: (await team.isMember(event.user))
        ? {
            channel: config.teamChannelId,
            sendEmoji: config.sendEmoji,
            deleteEmoji: config.deleteEmoji,
            publishCommand: Boolean(config.publishCommand),
            publishShortcut: config.publishShortcut,
            anonEncrypted: config.anonEncrypted,
            updates: canCheckForUpdates(config.sourceUrl),
          }
        : undefined,
    };
    const published = await publish(client, event.user, t, options);

    const user = event.user;
    clearTimeout(online.get(user)?.timer);
    const settle = async () => {
      online.delete(user);
      await publish(client, user, t, { ...published, online: undefined });
    };
    const timer = setTimeout(() => {
      settle().catch((error) => app.logger.warn(`Couldn't update the Home tab: ${errorCode(error)}`));
    }, onlineForMs);
    online.set(user, { timer, settle });
  });

  return {
    async stop() {
      const pending = [...online.values()];
      for (const { timer } of pending) clearTimeout(timer);
      await Promise.allSettled(pending.map(({ settle }) => settle()));
    },
  };
}
