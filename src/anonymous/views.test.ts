import type { KnownBlock } from '@slack/types';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import { modalTitle, slackDate } from '#src/slack/blocks.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import {
  anonModal,
  CONVERSATION_MAX_MESSAGES,
  INBOX_MAX_CONVERSATIONS,
  REPLY_BLOCK,
  conversationView,
  endView,
  inboxView,
  teamAnonStatus,
  withTeamAnonStatus,
  type ConversationView,
} from './views.ts';

const conversation = (handle: string, fields?: Partial<AnonConversation>): AnonConversation => ({
  id: 1,
  handle,
  teamThreadTs: '1.0',
  teamChannel: 'C1',
  owner: 'owner',
  createdAt: 0,
  lastActivityAt: 0,
  seenAt: 0,
  closedAt: null,
  closedBy: null,
  encrypted: false,
  contentKey: null,
  ...fields,
});

const thread = (c: AnonConversation, count: number): ConversationView => ({
  conversation: c,
  messages: Array.from({ length: count }, (_, i) => ({
    author: i % 2 ? 'team' : 'person',
    ts: `${1_700_000_000 + i}.000100`,
    body: richTextFromPlain(`mensaje ${i}`),
    isNew: i % 2 === 1,
  })),
});

const json = (value: unknown) => JSON.stringify(value);
/** Whether a view shows a text. The texts come from the locale files, so rewording them doesn't break the tests. */
const shows = (value: unknown, text: string) => json(value).includes(json(text).slice(1, -1));
const bot = { name: 'Helpdesk', avatar: 'https://example.com/helpdesk.png' };
const t = stringsIn('es', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });

test('with no conversations the window only has general information', () => {
  const view = inboxView(t, [], 7);
  assert.ok(shows(view, t.anonymous.window.empty));
  assert.match(json(view), /anon_new/);
  assert.doesNotMatch(json(view), /anon_open/);
});

test('the window lists conversations with what is new and when they close', () => {
  const now = 10 * DAY;
  const view = inboxView(t, 
    [
      { conversation: conversation('AAAA'), lastTs: '1700000000.000100', hasNew: true },
      {
        conversation: conversation('BBBB', { closedAt: now - DAY, closedBy: 'expired' }),
        lastTs: null,
        hasNew: false,
      },
    ],
    7,
    now,
  );
  assert.equal(json(view).match(/anon_open/g)?.length, 2);
  assert.ok(shows(view, `${t.anonymous.conversation.name}  ${t.anonymous.window.newReply}`));
  assert.ok(shows(view, t.anonymous.window.started({ date: slackDate('1.0') })));
  assert.ok(shows(view, t.anonymous.window.last({ date: slackDate('1700000000.000100') })));
  assert.ok(shows(view, t.anonymous.conversation.expired({ days: 6 })));
  // The handles are only in the buttons, never in what the window shows.
  const shown = view.blocks.map((b) => ('text' in b ? json(b.text) : '')).join();
  assert.doesNotMatch(shown, /AAAA|BBBB/);

  const many = Array.from({ length: INBOX_MAX_CONVERSATIONS + 5 }, (_, i) => ({
    conversation: conversation(`C${i}`),
    lastTs: null,
    hasNew: false,
  }));
  assert.equal(json(inboxView(t, many, 7)).match(/anon_open/g)?.length, INBOX_MAX_CONVERSATIONS);
});

test('an open conversation has an empty reply box, a send button and stays under 100 blocks', () => {
  const view = conversationView(t, thread(conversation('AAAA'), CONVERSATION_MAX_MESSAGES + 7), bot, 7, 123);
  assert.ok(view.blocks.length <= 100, `${view.blocks.length} blocks`);
  assert.equal(view.private_metadata, 'AAAA');
  assert.equal(view.title.text, modalTitle(t.anonymous.conversation.title).text);
  assert.equal(view.submit?.text, t.anonymous.conversation.send);
  const reply = view.blocks.find((b) => b.type === 'input');
  assert.equal(reply?.block_id, `${REPLY_BLOCK}123`);
  // The 7 earlier ones are a button away, and from there, the latest are too.
  assert.ok(shows(view, t.anonymous.conversation.earlier({ count: 7 })));
  assert.match(json(view), /"action_id":"anon_page_earlier","value":"30"/);
  const earlier = conversationView(t, thread(conversation('AAAA'), CONVERSATION_MAX_MESSAGES + 7), bot, 7, 123, { earlier: 30 });
  assert.equal(earlier.blocks.filter((b) => b.type === 'rich_text').length, 7);
  assert.match(json(earlier), /"action_id":"anon_page_later","value":"0"/);
  assert.ok(!shows(earlier, t.anonymous.conversation.earlier({ count: 7 })));
  // Shown again to read back, the reply box keeps its ID, and so what is typed in it.
  assert.equal(earlier.blocks.find((b) => b.type === 'input')?.block_id, `${REPLY_BLOCK}123`);
  const kept = conversationView(t, thread(conversation('AAAA'), 1), bot, 7, 999, { replyBlock: `${REPLY_BLOCK}123` });
  assert.equal(kept.blocks.find((b) => b.type === 'input')?.block_id, `${REPLY_BLOCK}123`);
  assert.match(json(view), /"anon_end"/);
  assert.equal(view.blocks.filter((b) => b.type === 'rich_text').length, CONVERSATION_MAX_MESSAGES);

  const again = conversationView(t, thread(conversation('AAAA'), 1), bot, 7, 456);
  assert.notEqual(again.blocks.find((b) => b.type === 'input')?.block_id, reply?.block_id);
});

test('a closed conversation can only be read', () => {
  const now = 10 * DAY;
  const view = conversationView(t, thread(conversation('AAAA', { closedAt: now, closedBy: 'team' }), 2), bot, 7, now);
  assert.equal(view.submit, undefined);
  assert.ok(!view.blocks.some((b) => b.type === 'input'));
  assert.doesNotMatch(json(view), /"anon_end"/);
  assert.match(json(view), /anon_delete_own/);
  assert.ok(shows(view, t.anonymous.conversation.endedByTeam({ days: 7 })));
});

test('a message gone from the team channel shows as unavailable', () => {
  const view = thread(conversation('AAAA'), 1);
  view.messages[0]!.body = null;
  assert.ok(shows(conversationView(t, view, bot, 7), t.anonymous.conversation.unavailable));
});

test('messages read like a chat: the bot with its avatar, close messages from one side grouped', () => {
  const at = (minutes: number) => `${1_700_000_000 + minutes * 60}.000100`;
  const body = richTextFromPlain('hola');
  // Ended, so the author's own messages have no menu and group too.
  const view = conversationView(t, 
    {
      conversation: conversation('AAAA', { closedAt: 1, closedBy: 'team' }),
      messages: [
        { author: 'person', ts: at(0), body, isNew: false },
        { author: 'person', ts: at(2), body, isNew: false },
        { author: 'team', ts: at(30), body, isNew: true },
        { author: 'team', ts: at(31), body, isNew: false },
        { author: 'team', ts: at(60), body, isNew: false },
        { author: 'person', ts: at(61), body, isNew: false },
      ],
    },
    bot,
    7,
  );
  const headers = view.blocks.filter((b) => b.type === 'context');
  assert.equal(headers.length, 4);
  assert.ok(shows(headers[0], t.anonymous.conversation.you));
  assert.match(json(headers[1]), /helpdesk\.png/);
  assert.match(json(headers[1]), /\*Helpdesk\*/);
  assert.ok(shows(headers[1], t.anonymous.conversation.new));
  assert.ok(!shows(headers[2], t.anonymous.conversation.new));
  assert.ok(shows(headers[3], t.anonymous.conversation.you));

  const noAvatar = conversationView(t, 
    { conversation: conversation('AAAA'), messages: [{ author: 'team', ts: at(0), body, isNew: false }] },
    { name: 'Soporte' },
    7,
  );
  assert.doesNotMatch(json(noAvatar), /"image"/);
  assert.match(json(noAvatar), /\*Soporte\*/);
});

test('ending asks whether to delete the messages too', () => {
  const view = endView(t, 'AAAA');
  assert.equal(view.callback_id, 'anon_end');
  assert.equal(view.private_metadata, 'AAAA');
  assert.ok(shows(view, t.anonymous.end.deleteOption));
});

test('the team status can be replaced on the parent message', () => {
  const open = teamAnonStatus(t, { state: 'open', sendEmoji: 'outbox_tray', closedVisibleDays: 7 });
  const parent: KnownBlock[] = [{ type: 'context', elements: [] }, richTextFromPlain('hola'), ...open];
  assert.match(json(parent), /anon_team_end/);

  const ended = withTeamAnonStatus(t, parent, { state: 'ended', note: 'terminada' });
  assert.equal(ended.length, 3);
  assert.match(json(ended), /terminada/);
  assert.doesNotMatch(json(ended), /anon_team_/);

  const forgotten = withTeamAnonStatus(t, ended, { state: 'forgotten', note: 'terminada' });
  assert.equal(forgotten.length, 4);
  assert.match(json(forgotten), /anon_team_delete/);
  assert.doesNotMatch(json(forgotten), /anon_team_end/);
  // Nothing in the team channel may carry the handle the author's window uses.
  assert.doesNotMatch(json([...open, ...forgotten]), /"value"/);
});

test('the form says the conversation will be encrypted, and for how long its text is kept, only when it will', () => {
  const said = t.anonymous.form.encrypted({ days: 365 });
  assert.ok(shows(anonModal(t, undefined, 365), said));
  assert.ok(!shows(anonModal(t), said));
});

test("an edited reply goes under a line of its own that says so, even right after another reply", () => {
  const c = conversation('AAAA');
  const view = conversationView(
    t,
    {
      conversation: c,
      messages: [
        { author: 'team', ts: '100', body: richTextFromPlain('first'), isNew: false },
        { author: 'team', ts: '160', body: richTextFromPlain('second, edited'), isNew: false, edited: true },
      ],
    },
    bot,
    7,
  );
  const lines = view.blocks.filter((b) => JSON.stringify(b).includes(`*${bot.name}*`));
  assert.equal(lines.length, 2);
  assert.ok(JSON.stringify(lines[1]).includes(`_${t.anonymous.conversation.editedReply}_`));
  assert.ok(!JSON.stringify(lines[0]).includes(t.anonymous.conversation.editedReply));
});

test("while a conversation is open, each of the author's messages has a line of its own, with a menu to edit or delete it", () => {
  const at = (minutes: number) => `${1_700_000_000 + minutes * 60}.000100`;
  const body = richTextFromPlain('hola');
  const messages = [
    { author: 'person' as const, ts: at(0), body, isNew: false },
    { author: 'person' as const, ts: at(1), body, isNew: false, edited: true },
  ];
  const view = conversationView(t, { conversation: conversation('AAAA'), messages }, bot, 7);
  const menus = view.blocks.filter((b) => b.type === 'section' && json(b).includes('anon_own_message'));
  assert.equal(menus.length, 2);
  assert.match(json(menus[0]), new RegExp(`edit:${at(0)}`));
  assert.ok(shows(menus[1], t.anonymous.conversation.editedMessage));
});

test('a message after an edited one goes under a line of its own, so the mark is only on the edited one', () => {
  const body = richTextFromPlain('hola');
  const view = conversationView(
    t,
    {
      conversation: conversation('AAAA'),
      messages: [
        { author: 'team', ts: '100', body, isNew: false, edited: true },
        { author: 'team', ts: '160', body, isNew: false },
      ],
    },
    bot,
    7,
  );
  const lines = view.blocks.filter((b) => JSON.stringify(b).includes(`*${bot.name}*`));
  assert.deepEqual(lines.map((b) => JSON.stringify(b).includes(t.anonymous.conversation.editedReply)), [true, false]);
});
