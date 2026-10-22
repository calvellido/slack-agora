import { App, SocketModeReceiver } from '@slack/bolt';
import { registerAnonymous } from './anonymous/index.ts';
import { ownerHasher } from './anonymous/keys.ts';
import { loadConfig } from './config.ts';
import type { Deps } from './deps.ts';
import { registerHome } from './home/index.ts';
import { I18n } from './i18n/index.ts';
import { recoverDowntime, startHeartbeat } from './inbox/downtime.ts';
import { registerInbox } from './inbox/index.ts';
import { startMonitorPings } from './monitor.ts';
import { ANON_SHORTCUT, PUBLISH_SHORTCUT, WRITE_SHORTCUT } from './manifest/index.ts';
import { registerPublish } from './publish/index.ts';
import { errorCode } from './slack/errors.ts';
import { botIdentity } from './slack/identity.ts';
import { Notices, noticeEmoji } from './slack/notices.ts';
import { TeamDirectory } from './slack/team-directory.ts';
import { warnAboutUnknownShortcuts } from './slack/unknown-shortcuts.ts';
import { Store } from './storage/index.ts';

// The entry point: reads the settings, opens the database, connects to Slack, registers every feature and starts.

// Settings and storage
const config = loadConfig();
const store = new Store(config.dbPath, config.teamChannelId);
const uptime = startHeartbeat(store.heartbeat);

// The Slack app, over Socket Mode, and the services every feature shares. The receiver is made here, for its
// connection's events.
const receiver = new SocketModeReceiver({ appToken: config.appToken, logLevel: config.logLevel });
const app = new App({ token: config.botToken, receiver, logLevel: config.logLevel });
const bot = await botIdentity(app.client);
const i18n = new I18n(
  app.client,
  // Without a publish command, no text mentions it.
  { bot: bot.name, publishCommand: config.publishCommand ?? '', anonymousCommand: config.anonCommand },
  config.teamLanguage,
);
const notices = await noticeEmoji(app.client, config.noticeEmoji);
if (notices.warning) app.logger.warn(notices.warning);
const deps: Deps = {
  config,
  store,
  team: new TeamDirectory(app.client, config.teamChannelId),
  anonOwner: ownerHasher(config.anonSecret),
  bot,
  i18n,
  notices: new Notices(config.teamChannelId, i18n.team.notices.sender, notices.emoji),
};

// Features
warnAboutUnknownShortcuts(app, [WRITE_SHORTCUT, ANON_SHORTCUT, PUBLISH_SHORTCUT]);
const anonymous = registerAnonymous(app, deps);
const inbox = registerInbox(app, deps, anonymous);
registerPublish(app, deps);
registerHome(app, deps);

// Log the Slack error code only: the default handler would print payloads, which carry message contents.
app.error(async (error) => {
  app.logger.error(`Listener failed: ${errorCode(error.original ?? error)}`);
});

// Start, telling the monitor, if there is one, while the bot is connected
const monitor = config.heartbeatUrl
  ? startMonitorPings(config.heartbeatUrl, receiver.client, app.logger, config.heartbeatMinutes * 60_000)
  : undefined;
await app.start();
try {
  const { channel } = await app.client.conversations.info({ channel: config.teamChannelId });
  if (!channel?.is_member) app.logger.warn(`${bot.name} is not in the team channel yet: run /invite @${bot.name} there`);
} catch (error) {
  app.logger.error(`Cannot read TEAM_CHANNEL_ID (${errorCode(error)}): invite ${bot.name} to the team channel and check the ID`);
}
app.logger.info(`${bot.name} is running`);

// Background work: catching up after downtime, once; ending and forgetting anonymous conversations, every hour
recoverDowntime(app.client, deps, inbox, uptime).catch((error) => app.logger.error(`Catching up failed: ${errorCode(error)}`));
const cleanup = () => {
  anonymous.cleanup(app.client).catch((error) => app.logger.error(`Cleanup failed: ${errorCode(error)}`));
};
cleanup();
const cleanupTimer = setInterval(cleanup, 60 * 60_000);

// Clean shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(cleanupTimer);
    monitor?.stop();
    uptime.stop();
    await app.stop();
    store.close();
    process.exit(0);
  });
}
