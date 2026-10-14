import { App } from '@slack/bolt';
import { ownerHasher } from './anonymity.ts';
import { registerAnonymous } from './anonymous.ts';
import { loadConfig } from './config.ts';
import { registerHome } from './home.ts';
import { I18n } from './i18n/index.ts';
import { registerInbox } from './inbox.ts';
import { registerPublish } from './publish.ts';
import { TeamDirectory, botIdentity, errorCode } from './slack.ts';
import { Store } from './store.ts';

const config = loadConfig();
const store = new Store(config.dbPath, config.teamChannelId);
const app = new App({
  token: config.botToken,
  appToken: config.appToken,
  socketMode: true,
  logLevel: config.logLevel,
});
const bot = await botIdentity(app.client);
const deps = {
  config,
  store,
  team: new TeamDirectory(app.client, config.teamChannelId),
  anonOwner: ownerHasher(config.anonSecret),
  bot,
  i18n: new I18n(
    app.client,
    { bot: bot.name, publishCommand: config.publishCommand, anonCommand: config.anonCommand },
    config.teamLanguage,
  ),
};

const anonymous = registerAnonymous(app, deps);
registerInbox(app, deps, anonymous);
registerPublish(app, deps);
registerHome(app, deps);

// Log the Slack error code only: the default handler would print payloads, which carry message contents.
app.error(async (error) => {
  app.logger.error(`Listener failed: ${errorCode(error.original ?? error)}`);
});

await app.start();
try {
  const { channel } = await app.client.conversations.info({ channel: config.teamChannelId });
  if (!channel?.is_member) app.logger.warn(`${bot.name} is not in the team channel yet: run /invite @${bot.name} there`);
} catch (error) {
  app.logger.error(`Cannot read TEAM_CHANNEL_ID (${errorCode(error)}): invite ${bot.name} to the team channel and check the ID`);
}
app.logger.info(`${bot.name} is running`);

const cleanup = () => {
  anonymous.cleanup(app.client).catch((error) => app.logger.error(`Cleanup failed: ${errorCode(error)}`));
};
cleanup();
const cleanupTimer = setInterval(cleanup, 60 * 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(cleanupTimer);
    await app.stop();
    store.close();
    process.exit(0);
  });
}
