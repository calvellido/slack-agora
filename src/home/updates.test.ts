import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { UPDATES_ACTION, githubRepository, newerOf, registerUpdateCheck, updatesView, type Release } from './updates.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const u = t.home.team.updates;
const REPOSITORY = 'https://github.com/example/agora';
const release = (version: string): Release => ({ tag: `v${version}`, url: `${REPOSITORY}/releases/tag/v${version}` });
const texts = (view: { blocks: unknown[] }) => JSON.stringify(view.blocks);
const shows = (view: { blocks: unknown[] }, text: string) => texts(view).includes(JSON.stringify(text).slice(1, -1));

test('the releases come from SOURCE_URL when it is a repository on GitHub', () => {
  assert.equal(githubRepository('https://github.com/calvellido/slack-agora'), 'calvellido/slack-agora');
  assert.equal(githubRepository('https://github.com/calvellido/slack-agora.git'), 'calvellido/slack-agora');
  assert.equal(githubRepository('https://github.com/calvellido/slack-agora/'), 'calvellido/slack-agora');
  assert.equal(githubRepository('https://gitlab.com/calvellido/slack-agora'), undefined);
  assert.equal(githubRepository('https://github.com/calvellido'), undefined);
  assert.equal(githubRepository(undefined), undefined);
});

test('the window says which newer release is out, with a link to what changed, and how it is installed', () => {
  const releases = ['3.3.0', '3.4.0', '3.5.0', '4.0.0'].map(release);
  const view = updatesView(t, '3.4.0', newerOf(releases, '3.4.0'));
  assert.ok(shows(view, u.newer({ current: '3.4.0', next: '3.5.0', url: release('3.5.0').url })));
  assert.ok(shows(view, u.newMajor({ version: '4.0.0', url: release('4.0.0').url })));
  assert.ok(shows(view, u.howTo));

  const latest = updatesView(t, '3.5.0', newerOf(['3.4.0', '3.5.0'].map(release), '3.5.0'));
  assert.ok(shows(latest, u.latest({ current: '3.5.0', major: '3' })));
  assert.ok(!shows(latest, u.howTo));
});

/** The button's handler, with GitHub answering `answers` in turn, and the windows it opens and updates recorded. */
function setup(answers: (() => Release[])[], member = true) {
  const windows: unknown[] = [];
  const client = {
    views: {
      open: async ({ view }: { view: unknown }) => (windows.push(view), { view: { id: 'V1' } }),
      update: async ({ view }: { view: unknown }) => (windows.push(view), {}),
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  let handler: (args: unknown) => Promise<void> = async () => {};
  const app = {
    action: (id: string, h: typeof handler) => id === UPDATES_ACTION && (handler = h),
    logger: { warn: () => {} },
  } as unknown as App;
  const deps = {
    config: { sourceUrl: REPOSITORY },
    team: { isMember: async () => member },
    i18n: new I18n(client, names, 'en'),
  } as unknown as Deps;
  let asked = 0;
  registerUpdateCheck(app, deps, async () => answers[asked++]!(), '3.4.0');
  const press = () => handler({ ack: async () => {}, body: { user: { id: 'U1' }, trigger_id: 'T1' }, client });
  return { windows, press, asked: () => asked };
}

test('pressing the button opens the window at once, and fills it in once GitHub answers, which is kept a while', async () => {
  const { windows, press, asked } = setup([() => ['3.4.0', '3.5.0'].map(release)]);
  await press();
  assert.ok(shows(windows[0] as never, u.checking));
  assert.ok(shows(windows[1] as never, u.newer({ current: '3.4.0', next: '3.5.0', url: release('3.5.0').url })));
  await press();
  assert.equal(asked(), 1);
});

test("when GitHub can't be reached the window says so, and the next press asks again", async () => {
  const { windows, press, asked } = setup([
    () => {
      throw new Error('fetch failed');
    },
    () => [release('3.4.0')],
  ]);
  await press();
  assert.ok(shows(windows[1] as never, u.failed));
  await press();
  assert.equal(asked(), 2);
  assert.ok(shows(windows[3] as never, u.latest({ current: '3.4.0', major: '3' })));
});

test('someone no longer in the team gets told it is only for the team, without checking', async () => {
  const { windows, press, asked } = setup([() => [release('3.5.0')]], false);
  await press();
  assert.equal(windows.length, 1);
  assert.ok(shows(windows[0] as never, t.publish.teamOnly));
  assert.equal(asked(), 0);
});
