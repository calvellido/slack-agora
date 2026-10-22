import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { Notices } from '#src/slack/notices.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import { Store } from '#src/storage/index.ts';
import { registerDms } from './dms.ts';
import { createRelay } from './relay.ts';

test('a written message is relayed as a DM, with a copy in the DM, and the next one continues its thread', async () => {
  const posts: { channel: string; text: string; thread_ts?: string }[] = [];
  const client = {
    conversations: { open: async () => ({ channel: { id: 'D1' } }) },
    chat: {
      postMessage: async (message: { channel: string; text: string; thread_ts?: string }) => {
        posts.push(message);
        return { ts: `${posts.length}.0`, message: { thread_ts: message.thread_ts } };
      },
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const app = { event: () => {}, logger: { warn: () => {} } } as unknown as App;
  const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
  const i18n = new I18n(client, names, 'en');
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7, sendEmoji: 'outbox_tray' },
    store: new Store(':memory:', 'CTEAM'),
    i18n,
    bot: { userId: 'UBOT' },
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  const dms = registerDms(app, deps, createRelay(deps));

  await dms.write(client, 'U1', richTextFromPlain('Hello team'));
  assert.deepEqual(posts.map((p) => [p.channel, p.thread_ts]), [['CTEAM', undefined], ['D1', undefined]]);
  const t = stringsIn('en', names);
  assert.equal(posts[0]!.text, `${t.inbox.thread.dmHeader({ user: 'U1' })} Hello team`);
  assert.equal(posts[1]!.text, `${t.inbox.dm.written} Hello team`);
  assert.ok(JSON.stringify(posts[1]).includes(JSON.stringify(t.inbox.dm.ack).slice(1, -1)));
  assert.equal(deps.store.conversations.latestDm('D1', 0)?.teamThreadTs, '1.0');

  await dms.write(client, 'U1', richTextFromPlain('One more thing'));
  assert.deepEqual(posts.slice(2).map((p) => [p.channel, p.thread_ts]), [['CTEAM', '1.0'], ['D1', undefined]]);
  assert.ok(!JSON.stringify(posts[3]).includes(JSON.stringify(t.inbox.dm.ack).slice(1, -1)));
});
