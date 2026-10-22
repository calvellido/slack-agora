import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { availableLanguages, catalogFrom, loadCatalog } from './catalog.ts';
import { check, generateTypes } from './generate.ts';
import { I18n, buildStrings, languageOf, stringsIn } from './index.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };

test('a Slack locale maps to its language, and anything unavailable to English', () => {
  assert.equal(languageOf('es-ES'), 'es');
  assert.equal(languageOf('es-LA'), 'es');
  assert.equal(languageOf('en-GB'), 'en');
  assert.equal(languageOf('fr-FR'), 'en');
  assert.equal(languageOf(undefined), 'en');
});

test('every language file is valid against English', () => {
  assert.deepEqual(availableLanguages().slice(0, 1), ['en']);
  const { errors } = check();
  assert.deepEqual(errors, []);
});

test('src/i18n/messages.ts is up to date (regenerate it with `pnpm i18n`)', () => {
  assert.equal(readFileSync(new URL('./messages.ts', import.meta.url), 'utf8'), generateTypes(loadCatalog('en')));
});

test('the texts use the names they are given', () => {
  const english = catalogFrom({ names: '{bot} {publishCommand} {anonymousCommand}', with: '{bot}, {user}' });
  const t = buildStrings('en', names, english, english) as unknown as { names: string; with: (p: { user: string }) => string };
  assert.equal(t.names, 'Helpdesk /post /anon');
  assert.equal(t.with({ user: 'U1' }), 'Helpdesk, U1');
});

test('plurals follow each language, and missing texts fall back to English', () => {
  const english = catalogFrom({ a: { days: 'In {days, plural, one {# day} other {# days}}' }, b: 'Only in English, {bot}' });
  const spanish = catalogFrom({ a: { days: 'En {days, plural, one {# día} other {# días}}' } });
  const t = buildStrings('es', names, english, spanish) as unknown as {
    a: { days: (p: { days: number }) => string };
    b: string;
  };
  assert.equal(t.a.days({ days: 1 }), 'En 1 día');
  assert.equal(t.a.days({ days: 3 }), 'En 3 días');
  assert.equal(t.b, 'Only in English, Helpdesk');

  // The real texts choose by number too: each count reads differently.
  const backOnline = (recovered: number) => stringsIn('en', names).inbox.backOnline({ duration: '3 min', since: 'x', recovered });
  assert.equal(new Set([backOnline(0), backOnline(1), backOnline(2)]).size, 3);
});

test('the check catches unknown keys, different values and broken messages, and lists what is missing', () => {
  const catalogs: Record<string, ReturnType<typeof catalogFrom>> = {
    en: catalogFrom({ greet: 'Hi {user}', bye: 'Bye', count: '{n, plural, one {# item} other {# items}}' }),
    xx: catalogFrom({ greet: 'Hola {persona}', typo: 'Ups', count: '{n, plural, one {# cosa}' }),
  };
  const { errors, missing } = check(['en', 'xx'], (language) => catalogs[language]!);
  assert.deepEqual(missing.get('xx'), ['bye']);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /xx: greet takes \{persona: string\}, but English takes \{user: string\}/);
  assert.match(errors.join('\n'), /xx: typo doesn't exist in English/);
  assert.match(errors.join('\n'), /xx: count is not a valid message/);
  assert.throws(() => catalogFrom({ a: 1 }), /a must be a text/);
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
  // A text that reads differently in each language, to tell which one each person got.
  const spanish = stringsIn('es', names).anonymous.window.title;
  const english = stringsIn('en', names).anonymous.window.title;
  assert.notEqual(spanish, english);

  assert.equal(i18n.team.anonymous.window.title, spanish);
  assert.equal((await i18n.forUser('U1')).anonymous.window.title, spanish);
  assert.equal((await i18n.forUser('U1')).anonymous.window.title, spanish);
  assert.equal((await i18n.forUser('U2')).anonymous.window.title, english);
  assert.equal((await i18n.forUser('U3')).anonymous.window.title, english);
  assert.deepEqual(calls, ['U1', 'U2', 'U3']);
});
