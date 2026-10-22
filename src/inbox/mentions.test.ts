import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { describeProblems } from '#src/slack/files.ts';
import { Notices } from '#src/slack/notices.ts';
import type { Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerMentions } from './mentions.ts';
import type { Relay } from './relay.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);

function setup(relay: Relay) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return { ok: true };
  };
  const client = {
    chat: { postEphemeral: record('chat.postEphemeral'), getPermalink: async () => ({ permalink: 'https://slack.example/p' }) },
    reactions: { add: record('reactions.add') },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  let onMention: (args: unknown) => Promise<void> = async () => {};
  const app = {
    event: (_: string, handler: typeof onMention) => (onMention = handler),
    logger: { error: () => {} },
  } as unknown as App;
  const store = new Store(':memory:', 'CTEAM');
  const deps = {
    config: { teamChannelId: 'CTEAM' },
    store,
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  registerMentions(app, deps, relay);
  const mention = (event: Record<string, unknown>) =>
    onMention({ event: { channel: 'CGENERAL', user: 'U1', ts: '5.0', text: '<@UBOT> hola', ...event }, client });
  return { calls, store, mention };
}

test("a mention's files that didn't reach the team are told to its author, where only they see", async () => {
  const problems = [{ name: 'big.zip', problem: 'tooLarge' as const }];
  const { calls, mention } = setup(async () => ({ started: '1.0', problems }));
  await mention({ ts: '6.0', thread_ts: '5.0' });
  const told = calls.find((c) => c.method === 'chat.postEphemeral')!.args;
  assert.deepEqual([told.channel, told.user, told.thread_ts], ['CGENERAL', 'U1', '5.0']);
  assert.equal(told.text, t.files.notReceived({ list: describeProblems(t, problems, 'person') }));
});
