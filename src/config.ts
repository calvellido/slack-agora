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
  /** The text of the app's About tab, in the team's language; without it, the ABOUT text in that language. */
  appLongDescription?: string;
  appColor: string;
  /** Bot scopes to request on top of the ones the code needs. */
  extraScopes: string[];
  /** Language of what the bot posts in the team channel, which everyone there shares, and of the manifest. */
  teamLanguage: Language;
  /** Slash commands. Writing with your name and the team's one are optional. */
  writeCommand?: string;
  anonCommand: string;
  /** Optional, since Slack shows commands to everyone. */
  publishCommand?: string;
  /** Whether the team has a message shortcut to post a copy of a message, which Slack also shows to everyone. */
  publishShortcut: boolean;
  /** Whether there are global shortcuts for the two forms, which Slack lists next to the commands; off by default. */
  writeShortcut: boolean;
  anonShortcut: boolean;
  /** Optional text for the Home tab: by language, with `default` for languages without their own. */
  about: Partial<Record<Language | 'default', string>>;
  /** Where the bot's code can be read, mentioned on the Home and About tabs; none if the deployment leaves it empty. */
  sourceUrl?: string;
}

export interface Config extends AppSettings {
  botToken: string;
  appToken: string;
  teamChannelId: string;
  dbPath: string;
  inboxIdleDays: number;
  sendEmoji: string;
  deleteEmoji: string;
  /** The icon of the bot's notices in the team channel. */
  noticeEmoji: string;
  /** A wide image across the top of the Home tab, at a public address. */
  homeBanner?: string;
  /** Whether the Home tab lists the people in the team channel, who read what people write. */
  homeTeamMembers: boolean;
  logLevel: LogLevel;
  anonSecret: string;
  anonIdleDays: number;
  anonClosedVisibleDays: number;
  anonMaxOpen: number;
}

/** A setting that is true or false, or `fallback` when it isn't set. */
function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase() || String(fallback);
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

/** Agora's own repository, the default SOURCE_URL. A deployment running its own fork points to that instead. */
export const AGORA_REPOSITORY = 'https://github.com/calvellido/slack-agora';

export function loadAppSettings(env: NodeJS.ProcessEnv = process.env): AppSettings {
  const command = (name: string, fallback: string): string => {
    const value = env[name]?.trim() || fallback;
    if (!/^\/[\p{Ll}\d_-]{1,31}$/u.test(value)) throw new Error(`${name} must be a slash command such as ${fallback}`);
    return value;
  };
  // Set but empty: no command.
  const optionalCommand = (name: string, fallback: string) =>
    env[name]?.trim() === '' ? undefined : command(name, fallback);
  const sourceUrl = env.SOURCE_URL === undefined ? AGORA_REPOSITORY : env.SOURCE_URL.trim() || undefined;
  if (sourceUrl && !/^https:\/\/\S+$/.test(sourceUrl)) throw new Error('SOURCE_URL must be an https:// address');
  const appName = env.APP_NAME?.trim() || 'Agora';
  if (appName.length > 35) throw new Error('APP_NAME must be at most 35 characters');
  const appDescription = env.APP_DESCRIPTION?.trim() || undefined;
  if (appDescription && appDescription.length > 140) throw new Error('APP_DESCRIPTION must be at most 140 characters');
  const appLongDescription = env.APP_LONG_DESCRIPTION?.trim().replaceAll('\\n', '\n') || undefined;
  if (appLongDescription && appLongDescription.length > 4000) {
    throw new Error('APP_LONG_DESCRIPTION must be at most 4000 characters');
  }
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
    appLongDescription,
    appColor,
    extraScopes: (env.EXTRA_BOT_SCOPES ?? '').split(/[\s,]+/).filter(Boolean),
    teamLanguage,
    writeCommand: optionalCommand('WRITE_COMMAND', '/agora-write'),
    anonCommand: command('ANONYMOUS_COMMAND', '/agora-anon'),
    publishCommand: optionalCommand('PUBLISH_COMMAND', '/agora-post'),
    publishShortcut: flag(env, 'PUBLISH_SHORTCUT', true),
    writeShortcut: flag(env, 'WRITE_SHORTCUT', false),
    anonShortcut: flag(env, 'ANONYMOUS_SHORTCUT', false),
    about,
    sourceUrl,
  };
}

/** Where the database lives; read apart from the rest by `pnpm clean-db`, which needs no secrets. */
export function databasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DB_PATH ?? 'data/agora.db';
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
  const homeBanner = env.HOME_BANNER_URL?.trim() || undefined;
  if (homeBanner && !/^https:\/\/\S+$/.test(homeBanner)) throw new Error('HOME_BANNER_URL must be an https:// address');
  const anonSecret = required('ANON_SECRET');
  if (anonSecret.length < 32) throw new Error('ANON_SECRET is too short: generate one with `openssl rand -base64 32`');

  return {
    ...loadAppSettings(env),
    botToken: required('SLACK_BOT_TOKEN'),
    appToken: required('SLACK_APP_TOKEN'),
    teamChannelId: required('TEAM_CHANNEL_ID'),
    dbPath: databasePath(env),
    inboxIdleDays: positive('INBOX_IDLE_DAYS', 7),
    sendEmoji: env.SEND_EMOJI ?? 'outbox_tray',
    deleteEmoji: env.DELETE_EMOJI ?? 'wastebasket',
    noticeEmoji: env.NOTICE_EMOJI?.trim().replace(/^:|:$/g, '') || 'robot_face',
    homeBanner,
    homeTeamMembers: flag(env, 'HOME_TEAM_MEMBERS', false),
    logLevel,
    anonSecret,
    anonIdleDays: positive('ANON_IDLE_DAYS', 30),
    anonClosedVisibleDays: positive('ANON_CLOSED_VISIBLE_DAYS', 7),
    anonMaxOpen: positive('ANON_MAX_OPEN', 3),
  };
}
