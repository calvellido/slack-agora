import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { Notices } from '#src/slack/notices.ts';
import { slackError, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerDms } from './dms.ts';
import type { Relay } from './relay.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);

/** DMs to the bot, relayed by `relay`, with what the bot posts and reacts recorded. */
function setup(relay: Relay) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return { ok: true, ts: '99.0' };
  };
  const client = {
    chat: { postMessage: record('chat.postMessage') },
    reactions: { add: record('reactions.add') },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const handlers: Record<string, (args: unknown) => Promise<void>> = {};
  const app = {
    event: (name: string, handler: (args: unknown) => Promise<void>) => (handlers[name] = handler),
    logger: { error: () => {}, warn: () => {} },
  } as unknown as App;
  const deps = {
    config: { teamChannelId: 'CTEAM', inboxIdleDays: 7 },
    store: new Store(':memory:', 'CTEAM'),
    i18n: new I18n(client, names, 'en'),
    bot: { userId: 'UBOT' },
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  registerDms(app, deps, relay);
  const dm = (event: Record<string, unknown>) => handlers.message!({ event: { channel_type: 'im', channel: 'D1', ...event }, client });
  const told = () => calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.args.text);
  return { calls, dm, told };
}

test("a DM that can't reach the team is not marked as received, and the person is told to send it again", async () => {
  const { calls, dm, told } = setup(async () => Promise.reject(slackError('not_in_channel')));
  await dm({ user: 'U1', ts: '5.0', text: 'Hola' });
  assert.deepEqual(told(), [t.inbox.relayFailed]);
  assert.ok(!calls.some((c) => c.method === 'reactions.add'));
});

test("a DM's files that didn't reach the team are told after the thanks", async () => {
  const problems = [{ name: 'big.zip', problem: 'tooLarge' as const }];
  const { calls, dm, told } = setup(async () => ({ started: '1.0', problems }));
  await dm({ user: 'U1', ts: '5.0', text: 'Hola', subtype: 'file_share' });
  assert.deepEqual(told(), [t.inbox.dm.ack, t.files.notReceived({ list: describeProblems(t, problems, 'person') })]);
  assert.ok(calls.some((c) => c.method === 'reactions.add' && c.args.name === 'incoming_envelope'));
});
