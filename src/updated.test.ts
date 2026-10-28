import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from './deps.ts';
import { I18n, stringsIn } from './i18n/index.ts';
import { Notices } from './slack/notices.ts';
import { Store } from './storage/index.ts';
import { announceVersion } from './updated.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const REPOSITORY = 'https://github.com/example/agora';

/** Starts of the bot with one database, with what it posts in the team channel recorded. */
function setup(sourceUrl: string | undefined) {
  const posted: string[] = [];
  const client = {
    chat: { postMessage: async (args: { text: string }) => (posted.push(args.text), { ok: true, ts: '1.0' }) },
  } as unknown as WebClient;
  const deps = {
    config: { sourceUrl },
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const { heartbeat } = new Store(':memory:', 'CTEAM');
  const start = (version: string, ranBefore = true) => announceVersion(client, deps, heartbeat, version, ranBefore);
  return { posted, start, heartbeat };
}

test('the team is told when the bot starts on a new version, with a link to what changed, and only then', async () => {
  const { posted, start } = setup(REPOSITORY);
  await start('3.3.0', false);
  await start('3.3.0');
  assert.deepEqual(posted, []);

  await start('3.4.0');
  await start('3.4.0');
  const url = `${REPOSITORY}/releases/tag/v3.4.0`;
  assert.deepEqual(posted, [t.notices.updated({ version: '3.4.0', previous: '3.3.0', notes: 'yes', url })]);
  assert.equal(posted[0], `🆕 Helpdesk has been updated to version 3.4.0, from 3.3.0. <${url}|What changed>`);
});

test('going back to an earlier version is told as such', async () => {
  const { posted, start } = setup(REPOSITORY);
  await start('3.4.0', false);
  await start('3.3.0');
  assert.deepEqual(posted, ['↩️ Helpdesk went back to version 3.3.0, from 3.4.0.']);
});

test("from before the version was kept, an update says so without the version it came from, and there's no link without SOURCE_URL", async () => {
  const { posted, start, heartbeat } = setup(undefined);
  await start('3.4.0', true);
  assert.deepEqual(posted, ['🆕 Helpdesk has been updated to version 3.4.0.']);
  assert.equal(heartbeat.lastVersion(), '3.4.0');
});
