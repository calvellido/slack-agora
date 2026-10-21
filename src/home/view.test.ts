import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { aboutBlocks, homeView } from './view.ts';

const t = stringsIn('en', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });
const team = {
  channel: 'C1',
  sendEmoji: 'outbox_tray',
  deleteEmoji: 'wastebasket',
  publishCommand: true,
  publishShortcut: true,
};

test('everyone gets the same Home tab, and team members also get how to act as the bot', () => {
  const everyone = JSON.stringify(homeView(t, { bot: { name: 'Helpdesk' } }));
  assert.match(everyone, /"action_id":"anon_inbox"/);
  assert.match(everyone, /"action_id":"write_open"/);
  assert.doesNotMatch(everyone, /You can also use/);
  assert.match(JSON.stringify(homeView(t, { bot: { name: 'Helpdesk' }, writeCommand: '/hd' })), /You can also use `\/hd`/);
  assert.match(everyone, /Write to the Helpdesk team/);
  assert.doesNotMatch(everyone, /publish_open|C1/);

  const member = JSON.stringify(homeView(t, { bot: { name: 'Helpdesk' }, team }));
  assert.match(member, /"action_id":"publish_open"/);
  assert.match(member, /:outbox_tray: Replying/);
  assert.match(member, /<#C1>/);
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
  const publishing = (ways: Partial<typeof team>) => {
    const view = JSON.stringify(homeView(t, { bot: { name: 'Helpdesk' }, team: { ...team, ...ways } }));
    return view.match(/as Helpdesk with the button below([^"]*)/)![1];
  };
  assert.equal(publishing({}), ", `/post`, or the shortcut in a message's *⋯* menu.");
  assert.equal(publishing({ publishShortcut: false }), ' or `/post`.');
  assert.equal(publishing({ publishCommand: false }), " or the shortcut in a message's *⋯* menu.");
  assert.equal(publishing({ publishCommand: false, publishShortcut: false }), '.');
});
