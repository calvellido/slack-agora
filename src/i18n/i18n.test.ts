import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebClient } from '@slack/web-api';
import { en } from './en.ts';
import { es } from './es.ts';
import { I18n, languageOf } from './index.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post' };

test('a Slack locale maps to its language, and anything unsupported to English', () => {
  assert.equal(languageOf('es-ES'), 'es');
  assert.equal(languageOf('es-LA'), 'es');
  assert.equal(languageOf('en-GB'), 'en');
  assert.equal(languageOf('fr-FR'), 'en');
  assert.equal(languageOf(undefined), 'en');
});

test('the texts use the names they are given', () => {
  for (const strings of [en(names), es(names)]) {
    const all = Object.values(strings)
      .map((value) => (typeof value === 'function' ? (value as (...args: unknown[]) => string)('U1', 'C1', 'x') : value))
      .join('\n');
    assert.match(all, /Helpdesk/);
    assert.match(all, /\/post/);
  }
});

test('every language has the same texts as English', () => {
  assert.deepEqual(Object.keys(es(names)).sort(), Object.keys(en(names)).sort());
});

test("people get their own Slack language, cached, and English if it can't be read", async () => {
  const calls: string[] = [];
  const locales: Record<string, string> = { U1: 'es-ES', U2: 'de-DE' };
  const client = {
    users: {
      info: async ({ user }: { user: string }) => {
        calls.push(user);
        if (!(user in locales)) throw new Error('user_not_found');
        return { user: { locale: locales[user] } };
      },
    },
  } as unknown as WebClient;
  const i18n = new I18n(client, names, 'es');

  assert.equal(i18n.team.publishSubmit, 'Publicar');
  assert.equal((await i18n.forUser('U1')).publishSubmit, 'Publicar');
  assert.equal((await i18n.forUser('U1')).publishSubmit, 'Publicar');
  assert.equal((await i18n.forUser('U2')).publishSubmit, 'Post');
  assert.equal((await i18n.forUser('U3')).publishSubmit, 'Post');
  assert.deepEqual(calls, ['U1', 'U2', 'U3']);
});
