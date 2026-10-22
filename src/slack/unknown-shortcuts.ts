import type { App } from '@slack/bolt';

/**
 * Logs the shortcuts Slack sends that no listener handles, which Slack shows to the person as failing. They come from
 * app settings older than this version's manifest, which pasting manifest.yml again fixes.
 */
export function warnAboutUnknownShortcuts(app: App, known: readonly string[]): void {
  app.use(async ({ body, next }) => {
    const shortcut = body.type === 'shortcut' || body.type === 'message_action';
    if (shortcut && 'callback_id' in body && !known.includes(body.callback_id)) {
      app.logger.warn(
        `Slack sent the shortcut ${body.callback_id}, which this version doesn't have: paste manifest.yml into the app settings`,
      );
    }
    await next();
  });
}
