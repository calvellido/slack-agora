import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Notices, noticeEmoji } from './notices.ts';

function fakeClient() {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const client = {
    chat: {
      postMessage: async (args: Record<string, unknown>) => {
        calls.push({ method: 'postMessage', args });
        return { ts: '9.0', message: { thread_ts: args.thread_ts } };
      },
      postEphemeral: async (args: Record<string, unknown>) => {
        calls.push({ method: 'postEphemeral', args });
        return {};
      },
    },
  } as unknown as WebClient;
  return { client, calls };
}

test('notices go to the team channel under their own name and icon, as a grey line', async () => {
  const { client, calls } = fakeClient();
  const notices = new Notices('C1', 'Helpdesk · avisos', 'robot_face');

  assert.equal(await notices.post(client, { text: '🔒 Ended.', threadTs: '1.0' }), '9.0');
  await notices.ephemeral(client, { user: 'U1', text: 'Only for you.' });
  await notices.post(client, { text: 'Posted', blocks: [{ type: 'divider' }] });

  const [inThread, ephemeral, withBlocks] = calls.map((c) => c.args);
  assert.deepEqual(
    { ...inThread },
    {
      channel: 'C1',
      thread_ts: '1.0',
      text: '🔒 Ended.',
      blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: '🔒 Ended.' }] }],
      unfurl_links: false,
      username: 'Helpdesk · avisos',
      icon_emoji: ':robot_face:',
    },
  );
  assert.equal(calls[1]!.method, 'postEphemeral');
  assert.equal(ephemeral!.user, 'U1');
  assert.equal(ephemeral!.username, 'Helpdesk · avisos');
  assert.deepEqual(withBlocks!.blocks, [{ type: 'divider' }]);
  assert.equal(withBlocks!.thread_ts, undefined);
});

test("automatic messages to people use the notices sender, named in that person's language", async () => {
  const { client, calls } = fakeClient();
  const notices = new Notices('C1', 'Helpdesk · avisos', 'robot_face');
  await notices.toPerson(client, { channel: 'D9', text: 'Thanks for writing!', username: 'Helpdesk · notices' });
  assert.deepEqual(
    { ...calls[0]!.args },
    {
      channel: 'D9',
      text: 'Thanks for writing!',
      blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: 'Thanks for writing!' }] }],
      username: 'Helpdesk · notices',
      icon_emoji: ':robot_face:',
    },
  );
});

test('the notices icon falls back to the robot when the workspace has no such emoji', async () => {
  const workspace = (fail = false) =>
    ({
      emoji: {
        list: async () => {
          if (fail) throw Object.assign(new Error('x'), { data: { error: 'missing_scope' } });
          return { emoji: { 'team-notices': 'https://e/x.png' }, categories: [{ name: 'Objects', emoji_names: ['gear'] }] };
        },
      },
    }) as unknown as WebClient;

  assert.deepEqual(await noticeEmoji(workspace(), 'team-notices'), { emoji: 'team-notices' });
  assert.deepEqual(await noticeEmoji(workspace(), 'gear'), { emoji: 'gear' });
  const missing = await noticeEmoji(workspace(), 'tema-notices');
  assert.equal(missing.emoji, 'robot_face');
  assert.match(missing.warning ?? '', /not an emoji in this workspace/);
  const unchecked = await noticeEmoji(workspace(true), 'team-notices');
  assert.equal(unchecked.emoji, 'team-notices');
  assert.match(unchecked.warning ?? '', /missing_scope/);
});
