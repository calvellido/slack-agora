import { LogLevel } from '@slack/bolt';
import { execSync } from 'node:child_process';
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
  /** A monitor's address the bot calls while it is up, so the monitor alerts when the calls stop. */
  heartbeatUrl?: string;
  /** How often it is called: once a day by default, as a monitor's checks often expect. */
  heartbeatMinutes: number;
  logLevel: LogLevel;
  anonSecret: string;
  anonIdleDays: number;
  anonClosedVisibleDays: number;
  anonMaxOpen: number;
  /** Whether new anonymous conversations are encrypted, with only placeholders in the team channel. */
  anonEncrypted: boolean;
  /** Days the team can still read an encrypted conversation after it ends, before its key is destroyed. */
  anonReadableDays: number;
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

/** Runs a command and returns what it prints, as for ANON_SECRET_COMMAND. */
export type RunCommand = (command: string) => string;

/** Through the shell, as it is written in .env; long enough to click through the system asking whether to allow it. */
const runCommand: RunCommand = (command) =>
  execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });

/**
 * ANON_SECRET, or else what ANON_SECRET_COMMAND prints, so the secret can stay in the system's keychain instead of in
 * .env, next to the database (see GUIDE.md). Not both, which would leave it in .env all the same. A failing command's
 * output is never shown, as it could be the secret; only its exit code and what it said on stderr.
 */
function anonSecretFrom(env: NodeJS.ProcessEnv, run: RunCommand): string {
  const secret = env.ANON_SECRET?.trim();
  const command = env.ANON_SECRET_COMMAND?.trim();
  if (secret && command) throw new Error('Set ANON_SECRET or ANON_SECRET_COMMAND, not both');
  if (secret) return secret;
  if (!command) throw new Error('Missing ANON_SECRET, or ANON_SECRET_COMMAND to read it from the keychain (see .env.example)');
  let printed: string;
  try {
    printed = run(command);
  } catch (error) {
    const { status, signal, stderr } = error as { status?: number | null; signal?: string | null; stderr?: string };
    const why = signal ? `stopped by ${signal}` : `exit code ${status ?? '?'}`;
    const said = String(stderr ?? '').trim().split('\n')[0]?.slice(0, 200);
    throw new Error(`ANON_SECRET_COMMAND failed (${why})${said ? `: ${said}` : ''}`);
  }
  const read = printed.trim();
  if (!read) throw new Error('ANON_SECRET_COMMAND printed nothing: is the secret stored where it looks for it?');
  return read;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, run: RunCommand = runCommand): Config {
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
  const heartbeatUrl = env.HEARTBEAT_URL?.trim() || undefined;
  if (heartbeatUrl && !/^https:\/\/\S+$/.test(heartbeatUrl)) throw new Error('HEARTBEAT_URL must be an https:// address');
  const anonSecret = anonSecretFrom(env, run);
  // A conversation's text must outlive its author's view of it, or their window would show it gone.
  const readableDays = positive('ANON_READABLE_DAYS', 365);
  if (readableDays < positive('ANON_CLOSED_VISIBLE_DAYS', 7)) {
    throw new Error('ANON_READABLE_DAYS must be at least ANON_CLOSED_VISIBLE_DAYS');
  }
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
    heartbeatUrl,
    heartbeatMinutes: positive('HEARTBEAT_MINUTES', 1440),
    logLevel,
    anonSecret,
    anonIdleDays: positive('ANON_IDLE_DAYS', 30),
    anonClosedVisibleDays: positive('ANON_CLOSED_VISIBLE_DAYS', 7),
    anonMaxOpen: positive('ANON_MAX_OPEN', 3),
    anonEncrypted: flag(env, 'ANON_ENCRYPTED', true),
    anonReadableDays: readableDays,
  };
}
