import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { serialized } from '#src/lib/serialized.ts';
import { context } from '#src/slack/blocks.ts';
import { Notices } from '#src/slack/notices.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import { slackError, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { registerChanges } from './changes.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const received = [{ name: 'incoming_envelope', users: ['UBOT'] }];

/** The team's copy of DM 5.0, as relay posts it: a header, the message, marked as its copy, and the small print. */
const header = context('<@U1> wrote:');
const late = context('⏱️ Sent while offline.');
const body = (block: KnownBlock): KnownBlock => ({ ...block, block_id: 'relayed-body-0' });
const copyBlocks = [header, body(richTextFromPlain('Hola')), late];

/** Slack, recording what the bot does; `fail` makes a method refuse, and `gone` means the team deleted the copy. */
function setup(options: { fail?: string[]; gone?: boolean; slowFirstRead?: boolean } = {}) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    if (options.fail?.includes(method)) throw slackError('fatal_error');
    return { ok: true, ts: '99.0' };
  };
  let reads = 0;
  const client = {
    chat: { postMessage: record('chat.postMessage'), update: record('chat.update'), delete: record('chat.delete') },
    conversations: {
      replies: async ({ ts }: { ts: string }) => {
        if (options.slowFirstRead && reads++ === 0) await new Promise((resolve) => setTimeout(resolve, 20));
        return { messages: options.gone ? [] : [{ ts, text: '<@U1> wrote: Hola', blocks: copyBlocks }] };
      },
    },
    files: {
      info: async ({ file }: { file: string }) => ({ file: { id: file, shares: { private: { CTEAM: [{ ts: '3.0' }] } } } }),
      delete: record('files.delete'),
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  let onMessage: (args: unknown) => Promise<void> = async () => {};
  const app = { event: (_: string, handler: typeof onMessage) => (onMessage = handler), logger: { error: () => {} } } as unknown as App;
  const store = new Store(':memory:', 'CTEAM');
  store.conversations.create({ kind: 'dm', userId: 'U1', targetChannel: 'D1', targetThreadTs: null, teamThreadTs: '1.0' });
  const copy = { dmChannel: 'D1', dmTs: '5.0', teamChannel: 'CTEAM', teamTs: '1.0', noticeTs: '2.0', problemsTs: '4.0', fileIds: ['FCOPY1', 'FCOPY2'] };
  store.relays.record(copy);
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
  const remove = (ts: string, previous?: Record<string, unknown>) =>
    dm({ subtype: 'message_deleted', deleted_ts: ts, previous_message: previous });
  const updates = () => calls.filter((c) => c.method === 'chat.update').map((c) => c.args);
  const told = () => calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.args.text);
  return { calls, store, copy, dm, edit, remove, updates, told };
}

test("editing a DM edits the team's copy, keeping its header and small print, and the person is told once", async () => {
  const { edit, updates, told } = setup();
  await edit('5.0', 'Hola, equipo');
  await edit('5.0', 'Hola, equipo!');
  const [first] = updates();
  assert.deepEqual(first, { channel: 'CTEAM', ts: '1.0', text: '<@U1> wrote: Hola, equipo', blocks: [header, body(richTextFromPlain('Hola, equipo')), late] });
  assert.equal(updates().length, 2);
  assert.deepEqual(told(), [t.inbox.dm.editForwarded]);
});

test('an edit that fails after one that went is still told, and so is one of a copy the team removed', async () => {
  const options = { fail: [] as string[] };
  const { edit, told } = setup(options);
  await edit('5.0', 'Hola, equipo');
  options.fail.push('chat.update');
  await edit('5.0', 'Hola, equipo!');
  assert.deepEqual(told(), [t.inbox.dm.editForwarded, t.inbox.dm.editFailed]);

  const gone = setup({ gone: true });
  await gone.edit('5.0', 'Hola, equipo');
  assert.deepEqual(gone.told(), [t.inbox.dm.editGone]);
});

test("deleting a DM takes it out of the team's copy and deletes its notices, and its files with their messages", async () => {
  const { calls, store, remove, updates, told } = setup();
  await remove('5.0', { user: 'U1', ts: '5.0', text: 'Hola', reactions: received });
  const deleted = t.inbox.thread.deletedByPerson({ user: 'U1' });
  assert.deepEqual(updates()[0]!.blocks, [header, body(context(deleted)), late]);
  // The notice with the images, the one naming the files that didn't go, and the message both copies were shared in.
  assert.deepEqual(calls.filter((c) => c.method === 'chat.delete').map((c) => c.args.ts), ['2.0', '4.0', '3.0']);
  assert.deepEqual(calls.filter((c) => c.method === 'files.delete').map((c) => c.args.file), ['FCOPY1', 'FCOPY2']);
  assert.equal(store.relays.get('D1', '5.0'), undefined);
  assert.deepEqual(told(), [t.inbox.dm.deletedForTeam]);
});

test('a deletion that leaves files, or the text, behind says so', async () => {
  const partly = setup({ fail: ['files.delete'] });
  await partly.remove('5.0', { user: 'U1', ts: '5.0', reactions: received });
  // The rest is still deleted.
  assert.deepEqual(partly.calls.filter((c) => c.method === 'chat.delete').map((c) => c.args.ts), ['2.0', '4.0', '3.0']);
  assert.deepEqual(partly.told(), [t.inbox.dm.deletedPartly]);

  const kept = setup({ fail: ['chat.update'] });
  await kept.remove('5.0', { user: 'U1', ts: '5.0', reactions: received });
  assert.deepEqual(kept.told(), [t.inbox.dm.deleted]);
});

test('a DM deleted with replies in its thread, or without Slack saying whose it was, is deleted for the team too', async () => {
  const tombstone = setup();
  await tombstone.dm({
    subtype: 'message_changed',
    message: { subtype: 'tombstone', user: 'USLACKBOT', ts: '5.0', text: 'This message was deleted.' },
    previous_message: { user: 'U1', ts: '5.0', text: 'Hola' },
  });
  assert.deepEqual(tombstone.told(), [t.inbox.dm.deletedForTeam]);

  // The person is known from their conversation.
  const unsaid = setup();
  await unsaid.remove('5.0');
  assert.deepEqual(unsaid.updates()[0]!.blocks, [header, body(context(t.inbox.thread.deletedByPerson({ user: 'U1' }))), late]);
  assert.deepEqual(unsaid.told(), [t.inbox.dm.deletedForTeam]);
});

test('changes wait for the DM to be relayed, and an edit and a deletion land in the order they were made', async () => {
  const { store, copy, remove, edit, updates, told } = setup({ slowFirstRead: true });
  store.relays.remove('D1', '5.0');
  // The relay records the copy at its end, under the same key as dms.ts.
  const relaying = serialized('D1', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.relays.record(copy);
  });
  await Promise.all([relaying, edit('5.0', 'Hola, equipo'), remove('5.0', { user: 'U1', ts: '5.0', reactions: received })]);
  assert.deepEqual(updates().map((u) => u.text), ['<@U1> wrote: Hola, equipo', `<@U1> wrote: ${t.inbox.thread.deletedByPerson({ user: 'U1' })}`]);
  assert.deepEqual(told(), [t.inbox.dm.editForwarded, t.inbox.dm.deletedForTeam]);
});

test('a DM relayed without a record of its copy is said to stay as it was, and one never relayed gets nothing', async () => {
  const { calls, dm, edit, remove, told } = setup();
  await edit('7.0', 'Hola!');
  await remove('7.0', { user: 'U1', ts: '7.0', text: 'Hola', reactions: received });
  assert.deepEqual(told(), [t.inbox.dm.edited, t.inbox.dm.deleted]);

  // Link previews change a message without editing it, and a DM without the mark never reached the team.
  await dm({ subtype: 'message_changed', message: { user: 'U1', ts: '8.0', text: 'a' } });
  await remove('9.0', { user: 'U1', ts: '9.0', text: 'a' });
  assert.equal(told().length, 2);
  assert.ok(!calls.some((c) => c.method === 'chat.update'));
});
