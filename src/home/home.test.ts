import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Activity } from '#src/activity.ts';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { registerHome } from './index.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const ONLINE_FOR_MS = 20;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Home tab, saying the bot is online for ONLINE_FOR_MS, with whether each tab it publishes says so recorded. */
function setup(test: TestContext) {
  const published: { user: string; online: boolean }[] = [];
  const client = {
    views: {
      publish: async ({ user_id, view }: { user_id: string; view: unknown }) => {
        const text = JSON.stringify(view);
        const online = text.includes(t.home.online({ checked: '' }).trim());
        assert.notEqual(online, text.includes(JSON.stringify(t.home.waiting).slice(1, -1)));
        published.push({ user: user_id, online });
        return { ok: true };
      },
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  let opened: (args: unknown) => Promise<void> = async () => {};
  const app = {
    event: (name: string, handler: typeof opened) => name === 'app_home_opened' && (opened = handler),
    action: () => {},
    logger: { warn: () => {} },
  } as unknown as App;
  const deps = {
    config: { about: {}, homeTeamMembers: false },
    team: { isMember: async () => false },
    bot: { name: 'Helpdesk' },
    i18n: new I18n(client, names, 'en'),
    activity: new Activity(),
  } as unknown as Deps;
  const home = registerHome(app, deps, () => ({}) as never, ONLINE_FOR_MS);
  test.after(() => home.stop());
  const open = (user: string) => opened({ event: { tab: 'home', user }, client });
  return { published, open, home };
}

test('opening the tab says the bot is online, and a while later that opening it checks, as it would once down', async (t) => {
  const { published, open } = setup(t);
  await open('U1');
  assert.deepEqual(published, [{ user: 'U1', online: true }]);
  await wait(ONLINE_FOR_MS * 3);
  assert.deepEqual(published, [{ user: 'U1', online: true }, { user: 'U1', online: false }]);
});

test('opening it again starts the while again', async (t) => {
  const { published, open } = setup(t);
  await open('U1');
  await wait(ONLINE_FOR_MS / 2);
  await open('U1');
  await wait(ONLINE_FOR_MS * 3);
  assert.deepEqual(
    published.map((p) => p.online),
    [true, true, false],
  );
});

test('a clean stop turns the tabs still saying the bot is online at once, and nothing after', async (t) => {
  const { published, open, home } = setup(t);
  await open('U1');
  await open('U2');
  await home.stop();
  assert.deepEqual(published.slice(2), [
    { user: 'U1', online: false },
    { user: 'U2', online: false },
  ]);
  await wait(ONLINE_FOR_MS * 3);
  assert.equal(published.length, 4);
});
