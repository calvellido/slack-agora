import { stringify } from 'yaml';
import { loadAppSettings, type AppSettings } from '#src/config.ts';
import { stringsIn } from '#src/i18n/index.ts';
import { readableUrl } from '#src/lib/url.ts';

// The Slack app's manifest, built from AppSettings (.env) and from what the code needs, so neither has to be kept
// in step with a hand-written manifest. `pnpm manifest` writes it to manifest.yml.

/** Callback IDs of the shortcuts, which the handlers listen for. */
export const WRITE_SHORTCUT = 'write_new';
export const ANON_SHORTCUT = 'anon_new';
export const PUBLISH_SHORTCUT = 'publish_as_bot';

/** The bot scopes the code uses. */
export const BOT_SCOPES = [
  'app_mentions:read', // @mentions of the bot
  'channels:read', // checking a public channel before posting in it
  'chat:write',
  'chat:write.customize', // the bot's notices in the team channel, under their own name and icon
  'chat:write.public', // posting in public channels without joining them
  'commands',
  'emoji:read', // checking that NOTICE_EMOJI exists in the workspace
  'groups:history', // reading the team channel's threads
  'groups:read', // the team channel's members, and private channels before posting in them
  'im:history', // DMs to the bot
  'im:read', // listing its DMs, to catch up on those sent while it was down
  'im:write', // DMs from the bot
  'reactions:read',
  'reactions:write',
  'users:read', // the bot's own profile, and each person's language
];

const BOT_EVENTS = ['app_home_opened', 'app_mention', 'message.im', 'reaction_added'];

/** Slack rejects a shorter long description. */
const LONG_DESCRIPTION_MIN = 174;

export function buildManifest(settings: AppSettings): { manifest: object; warnings: string[] } {
  const { appName, teamLanguage, writeCommand, publishCommand, anonCommand, publishShortcut } = settings;
  const names = { bot: appName, publishCommand: publishCommand ?? '', anonymousCommand: anonCommand };
  const t = stringsIn(teamLanguage, names);
  const warnings: string[] = [];

  // The About tab's text, or else the Home tab's, without Slack formatting or the Home tab's size marks, followed by
  // where to read the code. Slack shows it without links, so links keep their address, in readable form.
  const about = settings.appLongDescription ?? settings.about[teamLanguage] ?? settings.about.default;
  // Slack shows it as plain text, without links: the address goes in readable form, and the Home tab has the link.
  const source = settings.sourceUrl ? t.manifest.source({ address: readableUrl(settings.sourceUrl) }) : undefined;
  let longDescription = about
    ?.replace(/^-?# /gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url: string, text: string) => `${text} (${readableUrl(url)})`)
    .replace(/<(https?:\/\/[^|>]+)>/g, (_, url: string) => readableUrl(url))
    .replace(/<[^|>]+\|([^>]+)>/g, '$1');
  if (longDescription && source) longDescription = `${longDescription}\n\n${source}`;
  if (longDescription && longDescription.length < LONG_DESCRIPTION_MIN) {
    warnings.push(
      `The About tab's text is ${longDescription.length} characters, and Slack needs ${LONG_DESCRIPTION_MIN}, so it is ` +
        'left out.',
    );
    longDescription = undefined;
  }

  const manifest = {
    display_information: {
      name: appName,
      description: settings.appDescription ?? t.manifest.description,
      ...(longDescription ? { long_description: longDescription } : {}),
      background_color: settings.appColor,
    },
    features: {
      app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: appName, always_online: true },
      shortcuts: [
        { name: t.manifest.writeShortcut.name, type: 'global', callback_id: WRITE_SHORTCUT, description: t.manifest.writeShortcut.description },
        { name: t.manifest.anonymousShortcut.name, type: 'global', callback_id: ANON_SHORTCUT, description: t.manifest.anonymousShortcut.description },
        ...(publishShortcut
          ? [
              {
                name: t.manifest.publishShortcut.name,
                type: 'message',
                callback_id: PUBLISH_SHORTCUT,
                description: t.manifest.publishShortcut.description,
              },
            ]
          : []),
      ],
      slash_commands: [
        ...(writeCommand
          ? [
              {
                command: writeCommand,
                description: t.manifest.writeCommand.description,
                usage_hint: t.manifest.writeCommand.hint,
                should_escape: false,
              },
            ]
          : []),
        { command: anonCommand, description: t.manifest.anonymousCommand.description, should_escape: false },
        ...(publishCommand
          ? [
              {
                command: publishCommand,
                description: t.manifest.publishCommand.description,
                usage_hint: t.manifest.publishCommand.hint,
                should_escape: false,
              },
            ]
          : []),
      ],
    },
    oauth_config: { scopes: { bot: [...new Set([...BOT_SCOPES, ...settings.extraScopes])].sort() } },
    settings: {
      event_subscriptions: { bot_events: BOT_EVENTS },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
  return { manifest, warnings };
}

const HEADER = {
  own:
    "# Generated by `pnpm manifest` from .env and src/manifest/. Don't edit it by hand: change .env, run\n" +
    '# `pnpm manifest` again, and paste this file into App Manifest (YAML) in the app settings.\n',
  example:
    '# Example manifest, with the defaults of .env.example. Generated by `pnpm manifest --example`: don\'t edit it\n' +
    '# by hand. For your own app, set .env and run `pnpm manifest`, which writes manifest.yml.\n',
};

/** The manifest as YAML, which unlike JSON can say where it comes from. Slack's manifest editor takes either. */
export function renderManifest(manifest: object, kind: keyof typeof HEADER = 'own'): string {
  return `${HEADER[kind]}\n${stringify(manifest, { lineWidth: 0 })}`;
}

/** The example manifest: what an app gets with no settings at all. */
export function exampleManifest(): string {
  return renderManifest(buildManifest(loadAppSettings({})).manifest, 'example');
}
