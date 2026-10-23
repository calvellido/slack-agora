import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const env = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  TEAM_CHANNEL_ID: 'C1',
  ANON_SECRET: 'a-secret-of-at-least-thirty-two-characters',
};

test("anonymous conversations are encrypted by default, and their text can't go before their author stops seeing them", () => {
  const config = loadConfig(env);
  assert.deepEqual([config.anonEncrypted, config.anonReadableDays], [true, 365]);
  assert.equal(loadConfig({ ...env, ANON_ENCRYPTED: 'false' }).anonEncrypted, false);
  assert.throws(() => loadConfig({ ...env, ANON_READABLE_DAYS: '3', ANON_CLOSED_VISIBLE_DAYS: '7' }), /ANON_READABLE_DAYS/);
});
