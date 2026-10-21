import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { Deps } from '#src/deps.ts';
import { context } from '#src/slack/blocks.ts';

/**
 * The bot's Home tab: who is behind it and how to reach them, plus a cheat sheet for team members. It is the same for
 * everyone (in their language), so it never gives away that someone writes anonymously: those conversations live in
 * a modal.
 */
export function registerHome(app: App, { config, team, bot, i18n }: Deps): void {
  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;
    const language = await i18n.language(event.user);
    const t = i18n.in(language);
    const about = config.about[language] ?? config.about.default;

    const blocks: KnownBlock[] = [
      { type: 'header', text: { type: 'plain_text', text: bot.name } },
      ...(about ? [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: about } }] : []),
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: t.homeContact } },
      context(t.homeDeliveryHint),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: 'anon_inbox',
            style: 'primary',
            text: { type: 'plain_text', text: t.homeAnonButton },
          },
        ],
      },
      context(t.homeAnonHint),
    ];
    if (await team.isMember(event.user)) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: t.homeTeam(config.teamChannelId, config.sendEmoji, config.deleteEmoji) },
        },
      );
    }
    await client.views.publish({ user_id: event.user, view: { type: 'home', blocks } });
  });
}
