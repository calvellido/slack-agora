import { App, SocketModeReceiver } from '@slack/bolt';
import { Activity, watchRequests } from './activity.ts';
import { contentKeys } from './anonymous/content.ts';
import { registerAnonymous } from './anonymous/index.ts';
import { ownerHasher } from './anonymous/keys.ts';
import { loadConfig } from './config.ts';
import { consoleCommands } from './console/commands.ts';
import { startConsole } from './console/index.ts';
import { RESTART_CODE, launched } from './console/restart.ts';
import type { StatusInfo } from './console/status.ts';
import type { Deps } from './deps.ts';
import { registerHome } from './home/index.ts';
import { I18n } from './i18n/index.ts';
import { catchUpWhileRunning, recoverDowntime, startHeartbeat } from './inbox/downtime.ts';
import { registerInbox } from './inbox/index.ts';
import { VERSION } from './lib/version.ts';
import { Log } from './log.ts';
import { startMonitorPings } from './monitor.ts';
import { ANON_SHORTCUT, PUBLISH_SHORTCUT, WRITE_SHORTCUT, missingScopes } from './manifest/index.ts';
import { registerPublish } from './publish/index.ts';
import { errorCode } from './slack/errors.ts';
import { botIdentity } from './slack/identity.ts';
import { Notices, noticeEmoji } from './slack/notices.ts';
import { TeamDirectory } from './slack/team-directory.ts';
import { warnAboutUnknownShortcuts } from './slack/unknown-shortcuts.ts';
import { Store } from './storage/index.ts';
import { announceVersion } from './updated.ts';

// The entry point: reads the settings, opens the database, connects to Slack, registers every feature and starts.
// `pnpm start` runs it through launcher.ts, which can start it again.

// Settings and storage
const config = loadConfig();
const store = new Store(config.dbPath, config.teamChannelId);
const uptime = startHeartbeat(store.heartbeat);

// The Slack app, over Socket Mode, and the services every feature shares. The receiver is made here, for its
// connection's events. They share one log, whose level the console can change.
const log = new Log(config.logLevel);
const activity = new Activity();
const receiver = new SocketModeReceiver({ appToken: config.appToken, logger: log });
const app = new App({ token: config.botToken, receiver, logger: log, logLevel: log.getLevel() });
activity.watch(receiver.client);
const bot = await botIdentity(app.client);
// As when a new version needs a permission, and its manifest wasn't pasted into the app's settings yet
const missing = missingScopes(bot.scopes, config);
/** What the status shows besides the activity, for the console and the Home tab's button. */
const statusInfo = (): StatusInfo => ({
  version: VERSION,
  node: process.versions.node,
  level: log.level,
  monitor: config.heartbeatUrl !== undefined,
  missingScopes: missing,
  memoryBytes: process.memoryUsage.rss(),
});
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
  anonContent: contentKeys(config.anonSecret),
  bot,
  i18n,
  notices: new Notices(config.teamChannelId, i18n.team.notices.sender, notices.emoji),
  activity,
};

// Features
watchRequests(app, activity, log);
warnAboutUnknownShortcuts(app, [WRITE_SHORTCUT, ANON_SHORTCUT, PUBLISH_SHORTCUT]);
const anonymous = registerAnonymous(app, deps);
const inbox = registerInbox(app, deps, anonymous);
registerPublish(app, deps);
registerHome(app, deps, statusInfo);

// Log the Slack error code only: the default handler would print payloads, which carry message contents.
app.error(async (error) => {
  app.logger.error(`Listener failed: ${errorCode(error.original ?? error)}`);
});

// Start, telling the monitor, if there is one, while the bot is connected, and catching up on what it missed whenever
// the machine wakes from sleep or the connection comes back
const monitor = config.heartbeatUrl
  ? startMonitorPings(config.heartbeatUrl, receiver.client, app.logger, config.heartbeatMinutes * 60_000, (ok) => activity.pinged(ok))
  : undefined;
const gaps = catchUpWhileRunning(app.client, deps, inbox, receiver.client, app.logger);
await app.start();
try {
  const { channel } = await app.client.conversations.info({ channel: config.teamChannelId });
  if (!channel?.is_member) app.logger.warn(`${bot.name} is not in the team channel yet: run /invite @${bot.name} there`);
} catch (error) {
  app.logger.error(`Cannot read TEAM_CHANNEL_ID (${errorCode(error)}): invite ${bot.name} to the team channel and check the ID`);
}
if (missing?.length) {
  app.logger.warn(`${bot.name} lacks the permissions ${missing.join(', ')}: generate the manifest again and paste it in the app's settings`);
}
app.logger.info(`${bot.name} is running`);

// Background work: telling the team about a new version, and catching up after downtime, once; ending and forgetting
// anonymous conversations, every hour
announceVersion(app.client, deps, store.heartbeat, VERSION, uptime.lastAlive !== undefined).catch((error) => {
  app.logger.error(`Telling the team about the new version failed: ${errorCode(error)}`);
});
recoverDowntime(app.client, deps, inbox, uptime).catch((error) => app.logger.error(`Catching up failed: ${errorCode(error)}`));
const cleanup = () => {
  anonymous.cleanup(app.client).catch((error) => app.logger.error(`Cleanup failed: ${errorCode(error)}`));
};
cleanup();
const cleanupTimer = setInterval(cleanup, 60 * 60_000);

// The console, when the bot runs in a terminal
const terminal =
  process.stdin.isTTY && process.stdout.isTTY
    ? startConsole(
        consoleCommands({
          log,
          activity,
          info: statusInfo,
          restart: launched() ? () => void stop(RESTART_CODE) : undefined,
        }),
        { log, stop: () => void stop() },
      )
    : undefined;

// Clean shutdown, on a signal or from the console; with RESTART_CODE, the launcher starts the bot again. DMs it hasn't
// caught up on yet, after a sleep or while the connection is lost, are left for the next start.
let stopping: Promise<void> | undefined;
function stop(code = 0): Promise<void> {
  stopping ??= (async () => {
    terminal?.close();
    clearInterval(cleanupTimer);
    monitor?.stop();
    gaps.stop();
    uptime.stop(gaps.missingSince());
    await app.stop();
    store.close();
    process.exit(code);
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
