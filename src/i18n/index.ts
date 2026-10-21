import type { WebClient } from '@slack/web-api';
import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_LANGUAGE, availableLanguages, callerParams, loadCatalog, type Catalog } from './catalog.ts';
import type { Strings } from './messages.ts';

export { DEFAULT_LANGUAGE } from './catalog.ts';
export type { Strings } from './messages.ts';

/** What the texts mention by name everywhere: the bot as it appears in Slack, and the commands as set up in the app. */
export interface Names {
  bot: string;
  publishCommand: string;
  anonymousCommand: string;
}

/** A language code, such as `en`, with a file in locales/. */
export type Language = string;

const LANGUAGES = availableLanguages();

export function isLanguage(value: string): value is Language {
  return LANGUAGES.includes(value);
}

/** The language of a Slack locale such as `es-ES`, or the default one if it isn't available. */
export function languageOf(locale: string | undefined): Language {
  const language = locale?.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return isLanguage(language) ? language : DEFAULT_LANGUAGE;
}

/**
 * The texts of `language`, from its catalog, with English for any text it doesn't translate. Texts that take values
 * become functions; the names are filled in everywhere.
 */
export function buildStrings(language: Language, names: Names, english: Catalog, own: Catalog): Strings {
  const tree: Record<string, unknown> = {};
  for (const [key, reference] of english) {
    const translated = own.get(key);
    const locale = translated === undefined ? DEFAULT_LANGUAGE : language;
    const format = new IntlMessageFormat(translated ?? reference, locale, undefined, { ignoreTag: true });
    const text =
      callerParams(reference).size > 0
        ? (params: Record<string, string | number>) => String(format.format({ ...names, ...params }))
        : String(format.format({ ...names }));
    const path = key.split('.');
    let node = tree;
    for (const part of path.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[path.at(-1)!] = text;
  }
  return tree as unknown as Strings;
}

const catalogs = new Map<Language, Catalog>();

function catalog(language: Language): Catalog {
  let found = catalogs.get(language);
  if (!found) catalogs.set(language, (found = loadCatalog(language)));
  return found;
}

/** The texts of one language, outside the running bot (as for the manifest). */
export function stringsIn(language: Language, names: Names): Strings {
  return buildStrings(language, names, catalog(DEFAULT_LANGUAGE), catalog(language));
}

/** Texts in each person's Slack language, and in the team's language for what the bot posts in the team channel. */
export class I18n {
  readonly team: Strings;
  #client: WebClient;
  #byLanguage: Map<Language, Strings>;
  #users = new Map<string, { language: Language; fetchedAt: number }>();
  #ttlMs: number;

  constructor(client: WebClient, names: Names, teamLanguage: Language, ttlMs = 60 * 60_000) {
    this.#client = client;
    this.#byLanguage = new Map(LANGUAGES.map((language) => [language, stringsIn(language, names)]));
    this.team = this.in(teamLanguage);
    this.#ttlMs = ttlMs;
  }

  async language(userId: string): Promise<Language> {
    const cached = this.#users.get(userId);
    if (cached && Date.now() - cached.fetchedAt < this.#ttlMs) return cached.language;
    let language = cached?.language ?? DEFAULT_LANGUAGE;
    try {
      const { user } = await this.#client.users.info({ user: userId, include_locale: true });
      language = languageOf(user?.locale);
    } catch {
      // Keep the last known language, or the default one.
    }
    this.#users.set(userId, { language, fetchedAt: Date.now() });
    return language;
  }

  async forUser(userId: string): Promise<Strings> {
    return this.in(await this.language(userId));
  }

  in(language: Language): Strings {
    return this.#byLanguage.get(language) ?? this.#byLanguage.get(DEFAULT_LANGUAGE)!;
  }
}
