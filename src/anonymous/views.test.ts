import type { KnownBlock } from '@slack/types';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { DAY } from '#src/lib/time.ts';
import { richTextFromPlain } from '#src/slack/richtext.ts';
import type { AnonConversation } from '#src/storage/index.ts';
import {
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
const bot = { name: 'Helpdesk', avatar: 'https://example.com/helpdesk.png' };
const t = stringsIn('es', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });

test('with no conversations the window only has general information', () => {
  const view = inboxView(t, [], 7);
  assert.match(json(view), /No tienes conversaciones anónimas/);
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
  const text = json(view);
  assert.equal(text.match(/anon_open/g)?.length, 2);
  assert.match(text, /Conversación anónima\*  🆕 Respuesta nueva/);
  assert.match(text, /Empezó: <!date\^1\^.*Último mensaje: <!date\^1700000000\^/);
  assert.doesNotMatch(text, /AAAA\b.*Anónimo|#AAAA/);
  assert.match(text, /Terminada por inactividad\. Desaparecerá de aquí en 6 días/);

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
  assert.equal(view.title.text, 'Conversación anónima');
  assert.equal(view.submit?.text, 'Enviar');
  const reply = view.blocks.find((b) => b.type === 'input');
  assert.equal(reply?.block_id, `${REPLY_BLOCK}123`);
  assert.match(json(view), /7 mensajes anteriores sin mostrar/);
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
  assert.match(json(view), /Terminada por el equipo\. Desaparecerá de aquí en 7 días/);
});

test('a message gone from the team channel shows as unavailable', () => {
  const view = thread(conversation('AAAA'), 1);
  view.messages[0]!.body = null;
  assert.match(json(conversationView(t, view, bot, 7)), /ya no está disponible/);
});

test('messages read like a chat: the bot with its avatar, close messages from one side grouped', () => {
  const at = (minutes: number) => `${1_700_000_000 + minutes * 60}.000100`;
  const body = richTextFromPlain('hola');
  const view = conversationView(t, 
    {
      conversation: conversation('AAAA'),
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
  assert.match(json(headers[0]), /Tú/);
  assert.match(json(headers[1]), /helpdesk\.png/);
  assert.match(json(headers[1]), /\*Helpdesk\*.*🆕/);
  assert.doesNotMatch(json(headers[2]), /🆕/);
  assert.match(json(headers[3]), /Tú/);

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
  assert.match(json(view), /Borrar también mis mensajes/);
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
