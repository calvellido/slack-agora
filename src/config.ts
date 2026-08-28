import { LogLevel } from '@slack/bolt';
import { DEFAULT_LANGUAGE, isLanguage, type Language } from './i18n/index.ts';

/**
 * What names this deployment, shared by the bot and by `pnpm manifest`, which builds the Slack app's manifest from it.
 * It needs no secrets, so the manifest can be generated before the app (and its tokens) exist.
 */
export interface AppSettings {
  /** The app's name in Slack. The running bot reads its name from Slack instead, which normally is this one. */
  appName: string;
  appDescription?: string;
  appColor: string;
  /** Bot scopes to request on top of the ones the code needs. */
  extraScopes: string[];
  /** Language of what the bot posts in the team channel, which everyone there shares, and of the manifest. */
  teamLanguage: Language;
  /** The slash command to post as the bot. */
  publishCommand: string;
  /** Optional text for the Home tab: by language, with `default` for languages without their own. */
  about: Partial<Record<Language | 'default', string>>;
}

export interface Config extends AppSettings {
  botToken: string;
  appToken: string;
  teamChannelId: string;
  dbPath: string;
  inboxIdleDays: number;
  sendEmoji: string;
  deleteEmoji: string;
  logLevel: LogLevel;
}

export function loadAppSettings(env: NodeJS.ProcessEnv = process.env): AppSettings {
  const command = (name: string, fallback: string): string => {
    const value = env[name]?.trim() || fallback;
    if (!/^\/[\p{Ll}\d_-]{1,31}$/u.test(value)) throw new Error(`${name} must be a slash command such as ${fallback}`);
    return value;
  };
  const appName = env.APP_NAME?.trim() || 'Agora';
  if (appName.length > 35) throw new Error('APP_NAME must be at most 35 characters');
  const appDescription = env.APP_DESCRIPTION?.trim() || undefined;
  if (appDescription && appDescription.length > 140) throw new Error('APP_DESCRIPTION must be at most 140 characters');
  const appColor = env.APP_COLOR?.trim() || '#212121';
  if (!/^#([\da-f]{3}|[\da-f]{6})$/i.test(appColor)) throw new Error('APP_COLOR must be a color such as #212121');
  const teamLanguage = (env.TEAM_LANGUAGE?.trim().toLowerCase() || DEFAULT_LANGUAGE) as Language;
  if (!isLanguage(teamLanguage)) throw new Error(`TEAM_LANGUAGE ${teamLanguage} is not supported`);

  // ABOUT, ABOUT_EN, ABOUT_ES...; `\n` in the value starts a new line.
  const about: AppSettings['about'] = {};
  for (const [name, value] of Object.entries(env)) {
    const match = /^ABOUT(?:_([A-Z]{2}))?$/.exec(name);
    if (!match || !value?.trim()) continue;
    const language = match[1]?.toLowerCase() ?? 'default';
    if (language !== 'default' && !isLanguage(language)) continue;
    about[language as Language | 'default'] = value.trim().replaceAll('\\n', '\n');
  }

  return {
    appName,
    appDescription,
    appColor,
    extraScopes: (env.EXTRA_BOT_SCOPES ?? '').split(/[\s,]+/).filter(Boolean),
    teamLanguage,
    publishCommand: command('PUBLISH_COMMAND', '/agora-post'),
    about,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
    return value;
  };
  const positive = (name: string, fallback: number): number => {
    const value = Number(env[name] ?? fallback);
    if (!(value > 0)) throw new Error(`${name} must be a positive number`);
    return value;
  };
  const logLevel = (env.LOG_LEVEL ?? 'info') as LogLevel;
  if (!Object.values(LogLevel).includes(logLevel)) throw new Error(`Invalid LOG_LEVEL ${logLevel}`);

  return {
    ...loadAppSettings(env),
    botToken: required('SLACK_BOT_TOKEN'),
    appToken: required('SLACK_APP_TOKEN'),
    teamChannelId: required('TEAM_CHANNEL_ID'),
    dbPath: env.DB_PATH ?? 'data/agora.db',
    inboxIdleDays: positive('INBOX_IDLE_DAYS', 7),
    sendEmoji: env.SEND_EMOJI ?? 'outbox_tray',
    deleteEmoji: env.DELETE_EMOJI ?? 'wastebasket',
    logLevel,
  };
}
