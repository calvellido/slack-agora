import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { context } from '#src/slack/blocks.ts';
import { Notices } from '#src/slack/notices.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import type { Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerChanges } from './changes.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const received = [{ name: 'incoming_envelope', users: ['UBOT'] }];

/** The team's copy of DM 5.0, as relay posts it: a header, the message and the small print. */
const header = context('<@U1> wrote:');
const late = context('⏱️ Sent while offline.');
const copyBlocks = [header, richTextFromPlain('Hola'), late];

function setup() {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return { ok: true, ts: '99.0' };
  };
  const client = {
    chat: { postMessage: record('chat.postMessage'), update: record('chat.update'), delete: record('chat.delete') },
    conversations: { replies: async ({ ts }: { ts: string }) => ({ messages: [{ ts, text: '<@U1> wrote: Hola', blocks: copyBlocks }] }) },
    files: {
      info: async ({ file }: { file: string }) => ({ file: { id: file, shares: { private: { CTEAM: [{ ts: '3.0' }] } } } }),
      delete: record('files.delete'),
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  let onMessage: (args: unknown) => Promise<void> = async () => {};
  const app = { event: (_: string, handler: typeof onMessage) => (onMessage = handler), logger: { error: () => {} } } as unknown as App;
  const store = new Store(':memory:', 'CTEAM');
  store.relays.record({ dmChannel: 'D1', dmTs: '5.0', teamChannel: 'CTEAM', teamTs: '1.0', noticeTs: '2.0', fileIds: ['FCOPY1', 'FCOPY2'] });
  const deps = {
    store,
    i18n: new I18n(client, names, 'en'),
    bot: { userId: 'UBOT' },
    notices: new Notices('CTEAM', 'Helpdesk · notices', 'robot_face'),
  } as unknown as Deps;
  registerChanges(app, deps);
  const dm = (event: Record<string, unknown>) => onMessage({ event: { channel_type: 'im', channel: 'D1', ...event }, client });
  const edit = (ts: string, text: string) =>
    dm({
      subtype: 'message_changed',
      message: { user: 'U1', ts, text, blocks: [richTextFromPlain(text)], edited: { ts: '6.0' }, reactions: received },
      previous_message: { user: 'U1', ts, text: 'Hola' },
    });
  const told = () => calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.args.text);
  return { calls, store, dm, edit, told };
}

test("editing a DM edits the team's copy, keeping its header and small print, and the person is told once", async () => {
  const { calls, edit, told } = setup();
  await edit('5.0', 'Hola, equipo');
  await edit('5.0', 'Hola, equipo!');
  const update = calls.find((c) => c.method === 'chat.update')!.args;
  assert.deepEqual(update, { channel: 'CTEAM', ts: '1.0', text: '<@U1> wrote: Hola, equipo', blocks: [header, richTextFromPlain('Hola, equipo'), late] });
  assert.equal(calls.filter((c) => c.method === 'chat.update').length, 2);
  assert.deepEqual(told(), [t.inbox.dm.editForwarded]);
});

test("deleting a DM takes it out of the team's copy and deletes its files with their messages", async () => {
  const { calls, store, dm, told } = setup();
  await dm({ subtype: 'message_deleted', deleted_ts: '5.0', previous_message: { user: 'U1', ts: '5.0', text: 'Hola', reactions: received } });
  const deleted = t.inbox.thread.deletedByPerson({ user: 'U1' });
  assert.deepEqual(calls.find((c) => c.method === 'chat.update')!.args.blocks, [header, context(deleted), late]);
  // The notice with the images, and the message both copies were shared in.
  assert.deepEqual(calls.filter((c) => c.method === 'chat.delete').map((c) => c.args.ts), ['2.0', '3.0']);
  assert.deepEqual(calls.filter((c) => c.method === 'files.delete').map((c) => c.args.file), ['FCOPY1', 'FCOPY2']);
  assert.equal(store.relays.get('D1', '5.0'), undefined);
  assert.deepEqual(told(), [t.inbox.dm.deletedForTeam]);
});

test('a DM relayed without a record of its copy is said to stay as it was, and one never relayed gets nothing', async () => {
  const { calls, dm, edit, told } = setup();
  await edit('7.0', 'Hola!');
  await dm({ subtype: 'message_deleted', deleted_ts: '7.0', previous_message: { user: 'U1', ts: '7.0', text: 'Hola', reactions: received } });
  assert.deepEqual(told(), [t.inbox.dm.edited, t.inbox.dm.deleted]);

  // Link previews change a message without editing it, and a DM without the mark never reached the team.
  await dm({ subtype: 'message_changed', message: { user: 'U1', ts: '8.0', text: 'a' }, previous_message: { user: 'U1', text: 'a' } });
  await dm({ subtype: 'message_deleted', deleted_ts: '9.0', previous_message: { user: 'U1', ts: '9.0', text: 'a' } });
  assert.equal(told().length, 2);
  assert.ok(!calls.some((c) => c.method === 'chat.update'));
});
