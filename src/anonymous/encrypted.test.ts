import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import type { SlackMessage } from '#src/slack/messages.ts';
import { Notices } from '#src/slack/notices.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import { slackError, type Call } from '#src/slack/testing.ts';
import { Store } from '#src/storage/index.ts';
import { contentKeys } from './content.ts';
import { registerAnonymous } from './index.ts';
import { ownerHasher } from './keys.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const secret = 'a-secret-of-at-least-thirty-two-characters';

type Handler = (args: Record<string, unknown>) => Promise<void>;

/** Anonymous mode over a fake Slack that keeps what the bot posts, so it can read it back. */
function setup(encrypted = true) {
  const calls: Call[] = [];
  const posted = new Map<string, Record<string, unknown>>();
  let next = 0;
  const record = (method: string) => async (args: Record<string, unknown>) => (calls.push({ method, args }), { ok: true });
  const client = {
    chat: {
      postMessage: async (args: Record<string, unknown>) => {
        calls.push({ method: 'chat.postMessage', args });
        const ts = `${++next}.0`;
        posted.set(ts, { ts, thread_ts: args.thread_ts, text: args.text, blocks: args.blocks, bot_id: 'BBOT' });
        return { ok: true, ts, message: { thread_ts: args.thread_ts } };
      },
      update: async (args: Record<string, unknown>) => {
        calls.push({ method: 'chat.update', args });
        posted.set(args.ts as string, { ...posted.get(args.ts as string), text: args.text, blocks: args.blocks });
        return { ok: true };
      },
      delete: async (args: Record<string, unknown>) => (calls.push({ method: 'chat.delete', args }), posted.delete(args.ts as string), { ok: true }),
      postEphemeral: record('chat.postEphemeral'),
    },
    conversations: {
      replies: async ({ ts }: { ts: string }) => ({ messages: [...posted.values()].filter((m) => m.ts === ts || m.thread_ts === ts) }),
    },
    views: { open: record('views.open'), push: record('views.push'), update: record('views.update') },
    reactions: { add: record('reactions.add'), remove: record('reactions.remove') },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const handlers: Record<string, Handler> = {};
  const app = {
    action: (id: string, handler: Handler) => (handlers[`action:${id}`] = handler),
    view: (id: string, handler: Handler) => (handlers[`view:${id}`] = handler),
    command: () => {},
    shortcut: () => {},
    logger: { error: () => {} },
  } as unknown as App;
  const store = new Store(':memory:', 'CTEAM');
  const deps = {
    config: {
      teamChannelId: 'CTEAM',
      sendEmoji: 'outbox_tray',
      anonCommand: '/anon',
      anonIdleDays: 30,
      anonClosedVisibleDays: 7,
      anonReadableDays: 365,
      anonMaxOpen: 3,
      anonEncrypted: encrypted,
    },
    store,
    team: { isMember: async () => true },
    anonOwner: ownerHasher(secret),
    anonContent: contentKeys(secret),
    bot: { name: 'Helpdesk', botId: 'BBOT', userId: 'UBOT' },
    i18n: new I18n(client, names, 'en'),
    notices: new Notices('CTEAM', 'Helpdesk · bot', 'robot_face'),
  } as unknown as Deps;
  const anonymous = registerAnonymous(app, deps);
  const acks: unknown[] = [];
  const ack = async (response?: unknown) => void acks.push(response);
  const run = (name: string, args: Record<string, unknown>) => handlers[name]!({ ack, client, ...args });
  const text = (value: string) => ({ rich_text_value: richTextFromPlain(value) });
  const slack = () => JSON.stringify([...calls.filter((c) => c.method.startsWith('chat.')), ...posted.values()]);
  const viewOf = (method: string) => JSON.stringify((calls.filter((c) => c.method === method).at(-1)?.args as { view: unknown }).view);
  return { calls, posted, store, anonymous, acks, run, text, slack, viewOf, client };
}

test("an encrypted conversation leaves only placeholders in Slack, and both sides read it in their windows", async () => {
  const { store, run, text, slack, viewOf, posted } = setup();
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola, secreto') } } } } });
  const conversation = store.anonymous.byTeamThread('1.0')!;
  assert.equal(conversation.encrypted, true);
  assert.match(JSON.stringify(posted.get('1.0')), /anon_team_open/);

  // The team opens it and replies; the reply goes to the thread as a placeholder too.
  await run('action:anon_team_open', { body: { user: { id: 'UTEAM' }, message: { ts: '1.0' }, trigger_id: 'T1' } });
  assert.match(viewOf('views.open'), /Hola, secreto/);
  const reply = { 'reply-1': { reply: text('Gracias, lo vemos') } };
  await run('view:anon_team_conversation', { body: { user: { id: 'UTEAM' } }, view: { private_metadata: '1.0', state: { values: reply } } });
  const replyTs = store.anonymous.messages(conversation.id).find((m) => m.author === 'team')!.teamMessageTs;
  assert.equal((posted.get(replyTs) as { text: string }).text, t.anonymous.team.replied({ user: 'UTEAM' }));

  // The person writes again from their window, and reads the reply there.
  const own = { values: { 'reply-1': { reply: text('Otro secreto') } } };
  await run('view:anon_conversation', { body: { user: { id: 'U1' } }, view: { private_metadata: conversation.handle, state: own } });
  await run('action:anon_open', { body: { user: { id: 'U1' }, trigger_id: 'T2', view: { id: 'V1' } }, action: { value: conversation.handle } });
  assert.match(viewOf('views.push'), /Gracias, lo vemos/);
  assert.match(viewOf('views.push'), /Otro secreto/);

  // Nothing anyone wrote ever reached Slack, nor the database as it was written.
  assert.doesNotMatch(slack(), /secreto|Gracias/);
  assert.doesNotMatch(JSON.stringify(store.anonymous.messages(conversation.id)), /secreto|Gracias/);
});

test('anyone in the team edits or deletes a reply from the window', async () => {
  const { store, run, text, viewOf, calls, posted } = setup();
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola') } } } } });
  const reply = { 'reply-1': { reply: text('Gracias') } };
  await run('view:anon_team_conversation', { body: { user: { id: 'UTEAM' } }, view: { private_metadata: '1.0', state: { values: reply } } });
  const conversation = store.anonymous.byTeamThread('1.0')!;
  const replyTs = store.anonymous.messages(conversation.id).find((m) => m.author === 'team')!.teamMessageTs;

  // Someone else in the team edits it.
  await run('action:anon_team_reply', { body: { user: { id: 'UOTHER' }, trigger_id: 'T' }, action: { selected_option: { value: `edit:${replyTs}` } } });
  assert.match(viewOf('views.push'), /anon_team_edit/);
  const edited = { reply: { reply: text('Gracias, lo vemos el lunes') } };
  await run('view:anon_team_edit', { body: { user: { id: 'UOTHER' } }, view: { private_metadata: JSON.stringify({ ts: replyTs }), previous_view_id: 'V2', state: { values: edited } } });
  assert.match(viewOf('views.update'), /lo vemos el lunes/);
  // The edit leaves a trace: the placeholder and the team's window say who edited it, and the person sees it marked.
  assert.equal((posted.get(replyTs) as { text: string }).text, t.anonymous.team.repliedEdited({ user: 'UTEAM', editor: 'UOTHER' }));
  assert.ok(viewOf('views.update').includes(t.anonymous.teamWindow.editedBy({ user: 'UOTHER' })));
  await run('action:anon_open', { body: { user: { id: 'U1' }, trigger_id: 'T3', view: { id: 'V1' } }, action: { value: conversation.handle } });
  const personView = viewOf('views.push');
  assert.ok(personView.includes(`_${t.anonymous.conversation.editedReply}_`));
  assert.doesNotMatch(personView, /UOTHER|UTEAM/);

  // And deletes it: its placeholder says who, in place and with no new note, and both windows keep it in its place,
  // without its text.
  const notes = calls.filter((c) => c.method === 'chat.postMessage').length;
  await run('view:anon_team_withdraw', { body: { user: { id: 'UOTHER' } }, view: { private_metadata: JSON.stringify({ ts: replyTs }), previous_view_id: 'V2', state: { values: {} } } });
  assert.equal((posted.get(replyTs) as { text: string }).text, t.anonymous.team.repliedDeleted({ user: 'UTEAM', deleter: 'UOTHER' }));
  assert.ok(!calls.some((c) => c.method === 'chat.delete'));
  assert.equal(calls.filter((c) => c.method === 'chat.postMessage').length, notes);
  assert.deepEqual(store.anonymous.messages(conversation.id).map((m) => m.author), ['person']);
  const teamView = viewOf('views.update');
  assert.ok(teamView.includes(t.anonymous.teamWindow.deletedBy({ user: 'UOTHER' })));
  assert.doesNotMatch(teamView, /lo vemos el lunes/);
  assert.doesNotMatch(teamView, new RegExp(`edit:${replyTs}`));
  await run('action:anon_open', { body: { user: { id: 'U1' }, trigger_id: 'T4', view: { id: 'V1' } }, action: { value: conversation.handle } });
  const afterDeletion = viewOf('views.push');
  assert.ok(afterDeletion.includes(`_${t.anonymous.conversation.deletedReply}_`));
  assert.doesNotMatch(afterDeletion, /lo vemos el lunes|UOTHER/);
});

test('the send emoji in an encrypted thread points to the window, and a key destroyed leaves the text unreadable', async () => {
  const { store, run, text, anonymous, client, posted, viewOf } = setup();
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola') } } } } });
  const conversation = store.anonymous.byTeamThread('1.0')!;
  const told: string[] = [];
  await anonymous.sendReply(client, conversation, '9.0', { text: 'typed in the thread' } as SlackMessage, 'UTEAM', async (said) => void told.push(said));
  assert.deepEqual(told, [t.anonymous.team.replyFromWindow]);

  // A year after it ended, its key is destroyed: the status says so, and the open buttons go, from later messages too.
  const own = { values: { 'reply-1': { reply: text('Otra vez') } } };
  await run('view:anon_conversation', { body: { user: { id: 'U1' } }, view: { private_metadata: conversation.handle, state: own } });
  const later = store.anonymous.messages(conversation.id).at(-1)!.teamMessageTs;
  assert.match(JSON.stringify(posted.get(later)), /anon_team_open/);
  store.anonymous.close(conversation.id, 'team', Date.now() - 400 * DAY);
  await anonymous.cleanup(client);
  const parent = JSON.stringify(posted.get('1.0'));
  assert.match(parent, new RegExp(t.anonymous.team.textExpired({ days: 365 })));
  assert.doesNotMatch(parent, /anon_team_open/);
  assert.doesNotMatch(JSON.stringify(posted.get(later)), /anon_team_open/);
  assert.deepEqual(store.anonymous.messages(conversation.id), []);
  await run('action:anon_team_open', { body: { user: { id: 'UTEAM' }, message: { ts: '1.0' }, trigger_id: 'T' } });
  assert.match(viewOf('views.open'), /no longer available/);
});

test('with ANON_ENCRYPTED=false, a new conversation keeps its text in the thread, as before', async () => {
  const { store, run, text, posted } = setup(false);
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola, en claro') } } } } });
  assert.equal(store.anonymous.byTeamThread('1.0')?.encrypted, false);
  assert.match(JSON.stringify(posted.get('1.0')), /Hola, en claro/);
  assert.doesNotMatch(JSON.stringify(posted.get('1.0')), /anon_team_open/);
});

test('the person edits or deletes their own messages from their window, and the thread says so in place', async () => {
  const { store, run, text, slack, viewOf, posted } = setup();
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola, primero') } } } } });
  const conversation = store.anonymous.byTeamThread('1.0')!;
  const own = { values: { 'reply-1': { reply: text('Un detalle que me delata') } } };
  await run('view:anon_conversation', { body: { user: { id: 'U1' } }, view: { private_metadata: conversation.handle, state: own } });
  const second = store.anonymous.messages(conversation.id).at(-1)!.teamMessageTs;

  // Someone else can't, even knowing the handle.
  const menu = (user: string, value: string) =>
    run('action:anon_own_message', { body: { user: { id: user }, trigger_id: 'T', view: { private_metadata: conversation.handle } }, action: { selected_option: { value } } });
  await menu('U2', `edit:${second}`);
  assert.match(viewOf('views.push'), new RegExp(t.anonymous.unavailable));

  // Edited: the placeholder keeps its open button and says so, and the team reads the new text, marked.
  await menu('U1', `edit:${second}`);
  assert.match(viewOf('views.push'), /anon_own_edit/);
  const metadata = JSON.stringify({ handle: conversation.handle, ts: second });
  const edited = { reply: { reply: text('Un detalle cualquiera') } };
  await run('view:anon_own_edit', { body: { user: { id: 'U1' } }, view: { private_metadata: metadata, previous_view_id: 'V2', state: { values: edited } } });
  const placeholder = JSON.stringify(posted.get(second));
  assert.ok(placeholder.includes(t.anonymous.team.personEdited));
  assert.match(placeholder, /anon_team_open/);
  await run('action:anon_team_open', { body: { user: { id: 'UTEAM' }, message: { ts: second, thread_ts: '1.0' }, trigger_id: 'T' } });
  assert.match(viewOf('views.open'), /Un detalle cualquiera/);
  assert.ok(viewOf('views.open').includes(`_${t.anonymous.conversation.editedMessage}_`));
  assert.doesNotMatch(slack(), /delata|cualquiera|primero/);

  // Deleted, even the first: the thread keeps its status and buttons, and says the person deleted it.
  const first = JSON.stringify({ handle: conversation.handle, ts: '1.0' });
  await run('view:anon_own_delete', { body: { user: { id: 'U1' } }, view: { private_metadata: first, previous_view_id: 'V2', state: { values: {} } } });
  const parent = JSON.stringify(posted.get('1.0'));
  assert.ok(parent.includes(t.anonymous.team.personDeleted));
  assert.match(parent, /anon_team_open/);
  assert.match(parent, /anon_team_end/);
  assert.deepEqual(store.anonymous.messages(conversation.id).map((m) => m.teamMessageTs), [second]);
  await run('action:anon_team_open', { body: { user: { id: 'UTEAM' }, message: { ts: '1.0' }, trigger_id: 'T' } });
  assert.ok(viewOf('views.open').includes(`_${t.anonymous.teamWindow.deletedByPerson}_`));
  assert.doesNotMatch(viewOf('views.open'), /primero/);
});

test("in a conversation that isn't encrypted, the person's edit changes the thread's text", async () => {
  const { store, run, text, posted } = setup(false);
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola, en claro') } } } } });
  const conversation = store.anonymous.byTeamThread('1.0')!;
  const metadata = JSON.stringify({ handle: conversation.handle, ts: '1.0' });
  const edited = { reply: { reply: text('Hola, corregido') } };
  await run('view:anon_own_edit', { body: { user: { id: 'U1' } }, view: { private_metadata: metadata, previous_view_id: 'V2', state: { values: edited } } });
  const parent = JSON.stringify(posted.get('1.0'));
  assert.match(parent, /Hola, corregido/);
  assert.doesNotMatch(parent, /Hola, en claro/);
  assert.ok(parent.includes(t.anonymous.team.personEdited));
  assert.match(parent, /anon_team_end/);
});

test("in a conversation that isn't encrypted, a deletion Slack can't show is told to the person, and the message stays", async () => {
  const { store, run, text, posted, acks } = setup(false);
  await run('view:anon_message', { body: { user: { id: 'U1' } }, view: { state: { values: { message: { message: text('Hola, en claro') } } } } });
  const conversation = store.anonymous.byTeamThread('1.0')!;
  // Gone from the thread, so Slack can't change it: nothing is marked deleted that still shows there.
  posted.delete('1.0');
  const metadata = JSON.stringify({ handle: conversation.handle, ts: '1.0' });
  await run('view:anon_own_delete', { body: { user: { id: 'U1' } }, view: { private_metadata: metadata, previous_view_id: 'V2', state: { values: {} } } });
  assert.match(JSON.stringify(acks.at(-1)), new RegExp(t.anonymous.conversation.changeFailed));
  assert.deepEqual(store.anonymous.messages(conversation.id).map((m) => m.teamMessageTs), ['1.0']);
});

test("a thread Slack refuses to change doesn't hold back the cleanup: the others change, authors are forgotten and keys destroyed", async () => {
  const { store, run, text, posted, anonymous, client } = setup();
  for (const user of ['U1', 'U2', 'U3']) {
    await run('view:anon_message', { body: { user: { id: user } }, view: { state: { values: { message: { message: text(`Hola, soy ${user}`) } } } } });
  }
  const [first, second, old] = ['1.0', '2.0', '3.0'].map((ts) => store.anonymous.byTeamThread(ts)!);
  store.anonymous.touch(first!.id, Date.now() - 40 * DAY);
  store.anonymous.touch(second!.id, Date.now() - 40 * DAY);
  store.anonymous.close(old!.id, 'team', Date.now() - 400 * DAY);
  const update = client.chat.update;
  client.chat.update = (async (args: { ts: string }) => {
    if (args.ts === '1.0') throw slackError('cant_update_message');
    return update(args as never);
  }) as typeof update;

  await anonymous.cleanup(client);
  assert.ok(JSON.stringify(posted.get('2.0')).includes(t.anonymous.team.expired({ days: 30 })));
  assert.equal(store.anonymous.byId(second!.id)?.closedBy, 'expired');
  const forgotten = store.anonymous.byId(old!.id)!;
  assert.deepEqual([forgotten.owner, forgotten.contentKey], [null, null]);
});
