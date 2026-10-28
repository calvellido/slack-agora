import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { slackAgo, spacer } from '#src/slack/blocks.ts';
import { aboutBlocks, homeView } from './view.ts';

const t = stringsIn('en', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });
/** Whether a view shows a text. The texts come from the locale files, so rewording them doesn't break the tests. */
const shows = (value: unknown, text: string) => JSON.stringify(value).includes(JSON.stringify(text).slice(1, -1));
const count = (view: { blocks: { type: string }[] }, type: string) => view.blocks.filter((b) => b.type === type).length;
const team = {
  channel: 'C1',
  sendEmoji: 'outbox_tray',
  deleteEmoji: 'wastebasket',
  publishCommand: true,
  publishShortcut: true,
  anonEncrypted: true,
};

test('everyone gets the same Home tab, and team members also get how to act as the bot', () => {
  const everyone = homeView(t, { bot: { name: 'Helpdesk' } });
  assert.match(JSON.stringify(everyone), /"action_id":"anon_inbox"/);
  assert.match(JSON.stringify(everyone), /"action_id":"write_open"/);
  assert.ok(shows(everyone, t.home.intro));
  assert.doesNotMatch(JSON.stringify(everyone), /publish_open|status_open|C1/);
  // The hint about the command to write with your name, only when there is one.
  const withCommand = homeView(t, { bot: { name: 'Helpdesk' }, writeCommand: '/hd' });
  assert.ok(shows(withCommand, t.home.namedHint({ command: '/hd' })));
  assert.equal(count(withCommand, 'context'), count(everyone, 'context') + 1);

  const member = homeView(t, { bot: { name: 'Helpdesk' }, team });
  assert.match(JSON.stringify(member), /"action_id":"publish_open"/);
  assert.match(JSON.stringify(member), /"action_id":"status_open"/);
  assert.ok(shows(member, t.home.team.reply({ sendEmoji: 'outbox_tray', anonymous: 'encrypted' })));
  assert.ok(shows(member, t.home.team.conversations({ teamChannel: 'C1' })));
});

test("the buttons to look after the bot are a group of their own, apart from the posting one", () => {
  const view = homeView(t, { bot: { name: 'Helpdesk' }, team: { ...team, updates: true } });
  const rows = view.blocks.filter((b) => b.type === 'actions').map((b) => JSON.stringify(b));
  const ids = (row: string) => [...row.matchAll(/"action_id":"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(rows.at(-2)!), ['publish_open']);
  assert.deepEqual(ids(rows.at(-1)!), ['status_open', 'updates_check']);
  assert.ok(shows(view, t.home.team.maintenance({ updates: 'yes' })));
});

test('team members get a button to check for updates, when SOURCE_URL has releases to check', () => {
  const view = (updates: boolean) => JSON.stringify(homeView(t, { bot: { name: 'Helpdesk' }, team: { ...team, updates } }));
  assert.match(view(true), /"action_id":"updates_check"/);
  assert.doesNotMatch(view(false), /updates_check/);
  assert.doesNotMatch(JSON.stringify(homeView(t, { bot: { name: 'Helpdesk' } })), /updates_check/);
});

test('the avatar goes above the about text, which replaces the intro', () => {
  const bot = { name: 'Helpdesk', avatar: 'https://example.com/a.png' };
  const [avatar, title, intro] = homeView(t, { bot, about: 'We help.' }).blocks;
  assert.deepEqual(avatar, { type: 'image', image_url: 'https://example.com/a.png', alt_text: 'Helpdesk' });
  assert.deepEqual(title, { type: 'header', text: { type: 'plain_text', text: 'Helpdesk' } });
  assert.deepEqual(intro, { type: 'section', text: { type: 'mrkdwn', text: 'We help.' } });
});

test('the about text can use a heading and small text, and a heading at the start replaces the name', () => {
  const about = '# The *Helpdesk*\nWe help.\n\nAlways.\n-# Small print\n-# More of it';
  assert.deepEqual(aboutBlocks(about), [
    { type: 'header', text: { type: 'plain_text', text: 'The *Helpdesk*' } },
    { type: 'section', text: { type: 'mrkdwn', text: 'We help.\n\nAlways.' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Small print\nMore of it' }] },
  ]);
  assert.deepEqual(homeView(t, { bot: { name: 'Helpdesk' }, about }).blocks.slice(0, 3), aboutBlocks(about));
  assert.deepEqual(aboutBlocks(`# ${'x'.repeat(200)}`), [
    { type: 'header', text: { type: 'plain_text', text: `${'x'.repeat(149)}…` } },
  ]);
});

test('a banner goes across the top, in place of the avatar', () => {
  const bot = { name: 'Helpdesk', avatar: 'https://example.com/a.png' };
  const banner = 'https://example.com/banner.png';
  const view = homeView(t, { bot, banner });
  assert.deepEqual(view.blocks[0], { type: 'image', image_url: banner, alt_text: 'Helpdesk' });
  assert.doesNotMatch(JSON.stringify(view), /a\.png/);
});

test("the team's part only mentions the ways to post the deployment has", () => {
  const view = (ways: Partial<typeof team>) => homeView(t, { bot: { name: 'Helpdesk' }, team: { ...team, ...ways } });
  assert.ok(shows(view({}), t.home.team.publish({ ways: 'both' })));
  assert.ok(shows(view({ publishShortcut: false }), t.home.team.publish({ ways: 'command' })));
  assert.ok(shows(view({ publishCommand: false }), t.home.team.publish({ ways: 'shortcut' })));
  assert.ok(shows(view({ publishCommand: false, publishShortcut: false }), t.home.team.publish({ ways: 'none' })));
});

test('the bottom of the Home tab says where to read the code, which version is running, and whether the bot is', () => {
  const url = 'https://github.com/example/helpdesk/';
  const source = t.home.source({ url, label: 'github.com/example/helpdesk' });
  const version = t.home.version({ version: '1.2.3' });
  const online = t.home.online({ checked: slackAgo(1_000_000) });
  const footer = (options: { sourceUrl?: string; version?: string; online?: number }) =>
    homeView(t, { bot: { name: 'Helpdesk' }, ...options }).blocks.at(-1);
  const note = (text: string) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
  assert.deepEqual(footer({ sourceUrl: url, version: '1.2.3', online: 1_000_000 }), note(`${source}\n${version} · ${online}`));
  assert.match(online, /<!date\^1000\^\{ago\}\|/);
  // Without saying it is online, it says opening the tab checks, which stays true once the bot is down.
  assert.deepEqual(footer({ version: '1.2.3' }), note(`${version} · ${t.home.waiting}`));
  assert.deepEqual(footer({}), note(t.home.waiting));
});

test('the people in the team channel can be listed after the about text, before its small text', () => {
  const ana = { id: 'U1', name: 'Ana', avatar: 'https://example.com/ana.png' };
  const label = { type: 'section', text: { type: 'mrkdwn', text: t.home.members } };
  const row = {
    type: 'context',
    elements: [
      { type: 'image', image_url: 'https://example.com/ana.png', alt_text: 'Ana' },
      { type: 'mrkdwn', text: '<@U1>' },
      { type: 'mrkdwn', text: '<@U2>' },
    ],
  };
  const bot = { name: 'Helpdesk' };
  const members = [ana, { id: 'U2', name: 'Bea' }];
  const intro = (about: string, extra: number) =>
    homeView(t, { bot, about, members }).blocks.slice(0, aboutBlocks(about).length + extra);
  const [title, text, small] = aboutBlocks('# Us\nWe help.\n-# Small print');
  assert.deepEqual(intro('# Us\nWe help.\n-# Small print', 3), [title, text, label, row, spacer(), small]);
  assert.deepEqual(intro('# Us\nWe help.', 2), [title, text, label, row]);

  // Five people a row, as Slack allows ten elements in one.
  const seven = Array.from({ length: 7 }, (_, n) => ({ ...ana, id: `U${n}` }));
  const rows = homeView(t, { bot, members: seven }).blocks.filter((b) => b.type === 'context' && shows(b, '<@U'));
  assert.deepEqual(rows.map((r) => (r as { elements: unknown[] }).elements.length), [10, 4]);
  const without = homeView(t, { bot });
  assert.equal(homeView(t, { bot, members: [] }).blocks.length, without.blocks.length);
});
