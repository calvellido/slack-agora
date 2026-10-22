import { App } from '@slack/bolt';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { warnAboutUnknownShortcuts } from './unknown-shortcuts.ts';

test('a shortcut no listener knows is logged, so outdated app settings are easy to spot', async () => {
  const warnings: string[] = [];
  const logger = { debug() {}, info() {}, warn: (m: string) => warnings.push(m), error() {}, setLevel() {}, getLevel() {}, setName() {} };
  const app = new App({
    signingSecret: 'test',
    authorize: async () => ({ botToken: 'xoxb-test', botId: 'B1', botUserId: 'UBOT' }),
    logger: logger as never,
  });
  warnAboutUnknownShortcuts(app, ['anon_new']);
  app.shortcut('anon_new', async ({ ack }) => ack());
  const send = (callback_id: string) =>
    app.processEvent({
      body: { type: 'shortcut', callback_id, trigger_id: 't', user: { id: 'U1' }, team: { id: 'T1' }, token: 'x', action_ts: '1' },
      ack: async () => {},
    } as never);

  await send('anon_new');
  assert.deepEqual(warnings, []);
  await send('old_shortcut');
  assert.match(warnings.join(), /Slack sent the shortcut old_shortcut, which this version doesn't have/);
});
