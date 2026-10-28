import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const env = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  TEAM_CHANNEL_ID: 'C1',
  ANON_SECRET: 'a-secret-of-at-least-thirty-two-characters',
};

test('ANON_SECRET can come from a command, such as one reading the keychain, but not from both', () => {
  const { ANON_SECRET: secret, ...rest } = env;
  const command = { ...rest, ANON_SECRET_COMMAND: 'secret-tool lookup service agora key anon_secret' };
  const ran: string[] = [];
  const config = loadConfig(command, (run) => (ran.push(run), `${secret}\n`));
  assert.equal(config.anonSecret, secret);
  assert.deepEqual(ran, ['secret-tool lookup service agora key anon_secret']);

  assert.throws(() => loadConfig({ ...env, ANON_SECRET_COMMAND: 'x' }, () => secret), /not both/);
  assert.throws(() => loadConfig(rest, () => secret), /ANON_SECRET_COMMAND/);
  assert.throws(() => loadConfig(command, () => '  \n'), /printed nothing/);
});

test("a failing ANON_SECRET_COMMAND says why, but never what it printed, which could be the secret", () => {
  const { ANON_SECRET: secret, ...rest } = env;
  const failing = () => {
    throw Object.assign(new Error('Command failed'), { status: 44, stdout: secret, stderr: 'The specified item could not be found in the keychain.\n' });
  };
  assert.throws(
    () => loadConfig({ ...rest, ANON_SECRET_COMMAND: 'security find-generic-password -w' }, failing),
    (error: Error) => error.message === 'ANON_SECRET_COMMAND failed (exit code 44): The specified item could not be found in the keychain.' && !error.message.includes(secret),
  );
});

test("anonymous conversations are encrypted by default, and their text can't go before their author stops seeing them", () => {
  const config = loadConfig(env);
  assert.deepEqual([config.anonEncrypted, config.anonReadableDays], [true, 365]);
  assert.equal(loadConfig({ ...env, ANON_ENCRYPTED: 'false' }).anonEncrypted, false);
  assert.throws(() => loadConfig({ ...env, ANON_READABLE_DAYS: '3', ANON_CLOSED_VISIBLE_DAYS: '7' }), /ANON_READABLE_DAYS/);
});

test('emoji are named as reactions name them, with or without colons, and the send and delete ones differ', () => {
  const config = loadConfig({ ...env, SEND_EMOJI: ':rocket: ', DELETE_EMOJI: '', NOTICE_EMOJI: ':bell:' });
  assert.deepEqual([config.sendEmoji, config.deleteEmoji, config.noticeEmoji], ['rocket', 'wastebasket', 'bell']);
  assert.throws(() => loadConfig({ ...env, SEND_EMOJI: 'x', DELETE_EMOJI: ':x:' }), /must be different/);
});

test('the monitor is called at most as rarely as a timer can wait', () => {
  assert.equal(loadConfig({ ...env, HEARTBEAT_MINUTES: '35791' }).heartbeatMinutes, 35791);
  assert.throws(() => loadConfig({ ...env, HEARTBEAT_MINUTES: '40000' }), /HEARTBEAT_MINUTES/);
});
