import type { App } from '@slack/bolt';
import type { Deps } from '#src/deps.ts';
import { VERSION } from '#src/lib/version.ts';
import { errorCode } from '#src/slack/errors.ts';
import type { Person } from '#src/slack/team-directory.ts';
import { homeView, type HomeOptions } from './view.ts';

/** The bot's Home tab, published again every time someone opens it, in their language. */
export function registerHome(app: App, { config, team, bot, i18n }: Deps): void {
  // Without the list, the tab still opens: Slack may be slow or the channel unreadable for a moment.
  async function teamPeople(): Promise<Person[] | undefined> {
    try {
      return await team.people();
    } catch (error) {
      app.logger.warn(`Couldn't list the team channel's people for the Home tab: ${errorCode(error)}`);
      return undefined;
    }
  }

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
      team: (await team.isMember(event.user))
        ? {
            channel: config.teamChannelId,
            sendEmoji: config.sendEmoji,
            deleteEmoji: config.deleteEmoji,
            publishCommand: Boolean(config.publishCommand),
            publishShortcut: config.publishShortcut,
            anonEncrypted: config.anonEncrypted,
          }
        : undefined,
    };
    try {
      await client.views.publish({ user_id: event.user, view: homeView(t, options) });
    } catch (error) {
      if (!options.banner) throw error;
      // Slack refuses the whole tab when it can't fetch an image, so it goes without the banner.
      app.logger.warn(`Slack couldn't show HOME_BANNER_URL (${errorCode(error)}): the Home tab goes without it`);
      await client.views.publish({ user_id: event.user, view: homeView(t, { ...options, banner: undefined }) });
    }
  });
}
