import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { loadAppSettings } from '#src/config.ts';
import { stringsIn } from '#src/i18n/index.ts';
import {
  ANON_SHORTCUT,
  BOT_SCOPES,
  PUBLISH_SHORTCUT,
  WRITE_SHORTCUT,
  buildManifest,
  contrastWithWhite,
  exampleManifest,
  renderManifest,
} from './index.ts';

type Manifest = {
  display_information: { name: string; description: string; long_description?: string };
  features: {
    bot_user: { display_name: string };
    shortcuts?: { name: string; callback_id: string }[];
    slash_commands: { command: string; description: string }[];
  };
  oauth_config: { scopes: { bot: string[] } };
};

const build = (env: NodeJS.ProcessEnv) => {
  const { manifest, warnings } = buildManifest(loadAppSettings(env));
  return { manifest: manifest as Manifest, warnings };
};

test('the manifest takes names and commands from the settings, in the team language', () => {
  const { manifest } = build({
    APP_NAME: 'Helpdesk',
    WRITE_COMMAND: '/hd',
    PUBLISH_COMMAND: '/hd-post',
    ANONYMOUS_COMMAND: '/hd-anon',
    WRITE_SHORTCUT: 'true',
    ANONYMOUS_SHORTCUT: 'true',
    TEAM_LANGUAGE: 'es',
  });
  assert.equal(manifest.display_information.name, 'Helpdesk');
  assert.equal(manifest.features.bot_user.display_name, 'Helpdesk');
  const es = stringsIn('es', { bot: 'Helpdesk', publishCommand: '/hd-post', anonymousCommand: '/hd-anon' });
  assert.equal(manifest.display_information.description, es.manifest.description);
  assert.deepEqual(manifest.features.slash_commands.map((c) => c.command), ['/hd', '/hd-anon', '/hd-post']);
  assert.deepEqual(manifest.features.shortcuts!.map((s) => s.name), [
    es.manifest.writeShortcut.name,
    es.manifest.anonymousShortcut.name,
    es.manifest.publishShortcut.name,
  ]);
});

test('the shortcuts use the callback IDs the handlers listen for', () => {
  const { manifest } = build({ WRITE_SHORTCUT: 'true', ANONYMOUS_SHORTCUT: 'true' });
  assert.deepEqual(manifest.features.shortcuts!.map((s) => s.callback_id), [WRITE_SHORTCUT, ANON_SHORTCUT, PUBLISH_SHORTCUT]);
  for (const [file, constant] of [
    ['src/inbox/write.ts', 'WRITE_SHORTCUT'],
    ['src/anonymous/window.ts', 'ANON_SHORTCUT'],
    ['src/publish/index.ts', 'PUBLISH_SHORTCUT'],
  ] as const) {
    assert.match(readFileSync(file, 'utf8'), new RegExp(`callback_id: ${constant}`));
  }
});

test("the command to write with your name, and the team's command and message shortcut, can be left out", () => {
  const { manifest } = build({ WRITE_COMMAND: '', PUBLISH_COMMAND: '', PUBLISH_SHORTCUT: 'false' });
  assert.deepEqual(manifest.features.slash_commands.map((c) => c.command), ['/agora-anon']);
  assert.equal(manifest.features.shortcuts, undefined);
  assert.equal(loadAppSettings({}).publishCommand, '/agora-post');
  assert.equal(loadAppSettings({}).writeCommand, '/agora-write');
  assert.throws(() => loadAppSettings({ PUBLISH_SHORTCUT: 'no' }), /PUBLISH_SHORTCUT/);
});

test('the global shortcuts for the two forms are off unless set, leaving only the commands in Slack\'s / list', () => {
  assert.deepEqual(build({}).manifest.features.shortcuts!.map((s) => s.callback_id), [PUBLISH_SHORTCUT]);
  const { manifest } = build({ WRITE_SHORTCUT: 'true' });
  assert.deepEqual(manifest.features.shortcuts!.map((s) => s.callback_id), [WRITE_SHORTCUT, PUBLISH_SHORTCUT]);
  assert.throws(() => loadAppSettings({ WRITE_SHORTCUT: 'off' }), /WRITE_SHORTCUT/);
});

test('extra scopes are added to the ones the code needs', () => {
  const { manifest } = build({ EXTRA_BOT_SCOPES: 'files:read, users:read' });
  const scopes = manifest.oauth_config.scopes.bot;
  for (const scope of [...BOT_SCOPES, 'files:read']) assert.ok(scopes.includes(scope), scope);
  assert.equal(scopes.filter((s) => s === 'users:read').length, 1);
});

test('the about text becomes the long description, without formatting, when Slack accepts its length', () => {
  const long = `Somos *el equipo*. ${'Escríbenos. '.repeat(15)}`;
  const withAbout = build({ TEAM_LANGUAGE: 'es', ABOUT: 'Hi', ABOUT_ES: long, SOURCE_URL: '' });
  assert.equal(withAbout.manifest.display_information.long_description, long.replaceAll('*', '').trim());
  assert.deepEqual(withAbout.warnings, []);

  const short = build({ ABOUT: 'We are the team.', SOURCE_URL: '' });
  assert.equal(short.manifest.display_information.long_description, undefined);
  assert.equal(short.warnings.length, 1);

  assert.equal(build({}).manifest.display_information.long_description, undefined);

  const sized = build({ ABOUT: `# The team\\n${'Write to us. '.repeat(15)}\\n-# Small print`, SOURCE_URL: '' });
  assert.match(sized.manifest.display_information.long_description!, /^The team\nWrite to us\..*\nSmall print$/s);
});

test('the long description ends saying where to read the code, Agora\'s repository unless SOURCE_URL says otherwise', () => {
  const about = 'We are the people team, and we read everything you write to us. '.repeat(3).trim();
  const en = stringsIn('en', { bot: 'Agora', publishCommand: '/agora-post', anonymousCommand: '/agora-anon' });
  const note = (address: string) => `${about}\n\n${en.manifest.source({ address })}`;
  assert.equal(build({ ABOUT: about }).manifest.display_information.long_description, note('github.com/calvellido/slack-agora'));
  const fork = build({ ABOUT: about, SOURCE_URL: 'https://example.com/fork/' });
  assert.equal(fork.manifest.display_information.long_description, note('example.com/fork'));
  assert.equal(build({ ABOUT: about, SOURCE_URL: '' }).manifest.display_information.long_description, about);

  const linked = build({ ABOUT: `${about} Read <https://example.com/news/|our news> or <https://example.com/faq>.`, SOURCE_URL: '' });
  assert.equal(linked.manifest.display_information.long_description, `${about} Read our news (example.com/news) or example.com/faq.`);
  assert.throws(() => loadAppSettings({ SOURCE_URL: 'github.com/x' }), /SOURCE_URL/);
});

test("the About tab can have its own text instead of the Home tab's", () => {
  const own = `The people team, for everyone in the company.\\nWe answer within a week. ${'More. '.repeat(25)}`.trim();
  const { manifest } = build({ ABOUT: 'Hello! Write to us here.', APP_LONG_DESCRIPTION: own, SOURCE_URL: '' });
  assert.equal(manifest.display_information.long_description, own.replace('\\n', '\n'));
  assert.throws(() => loadAppSettings({ APP_LONG_DESCRIPTION: 'x'.repeat(4001) }), /APP_LONG_DESCRIPTION/);
});

test('a light APP_COLOR gets a warning, since Slack refuses light colours', () => {
  assert.deepEqual(build({}).warnings, []);
  assert.match(build({ APP_COLOR: '#ffffff' }).warnings.join(), /APP_COLOR #ffffff looks light/);
  assert.match(build({ APP_COLOR: '#eee' }).warnings.join(), /APP_COLOR #eee looks light/);
  assert.deepEqual(build({ APP_COLOR: '#0000AA' }).warnings, []);
  assert.equal(Math.round(contrastWithWhite('#000')), 21);
});

test('settings Slack would reject fail early', () => {
  assert.throws(() => loadAppSettings({ APP_NAME: 'x'.repeat(36) }), /APP_NAME/);
  assert.throws(() => loadAppSettings({ PUBLISH_COMMAND: 'publish' }), /PUBLISH_COMMAND/);
  assert.throws(() => loadAppSettings({ ANONYMOUS_COMMAND: `/${'a'.repeat(32)}` }), /ANONYMOUS_COMMAND/);
  assert.throws(() => loadAppSettings({ APP_COLOR: 'black' }), /APP_COLOR/);
});

test('the YAML file says not to edit it, and reads back as the same manifest', () => {
  const { manifest } = buildManifest(
    loadAppSettings({ TEAM_LANGUAGE: 'es', ABOUT_ES: `Somos el equipo: "Personas".\n\n${'Escríbenos. '.repeat(15)}` }),
  );
  const yaml = renderManifest(manifest);
  assert.match(yaml.split('\n')[0]!, /^# Generated by `pnpm manifest`.*Don't edit it by hand/);
  assert.deepEqual(parse(yaml), manifest);
});

test('manifest.example.yml is up to date (regenerate it with `pnpm manifest --example`)', () => {
  assert.equal(readFileSync('manifest.example.yml', 'utf8'), exampleManifest());
});
