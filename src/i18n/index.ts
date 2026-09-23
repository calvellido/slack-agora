import type { WebClient } from '@slack/web-api';
import { en } from './en.ts';
import { es } from './es.ts';

/** What the texts mention by name: the bot as it appears in Slack, and the commands as set up in the app. */
export interface Names {
  bot: string;
  publishCommand: string;
  anonCommand: string;
}

export type Strings = ReturnType<typeof en>;

/** Supported languages. To add one, copy es.ts, translate it, and list it here. */
const LANGUAGES = { en, es } satisfies Record<string, (names: Names) => Strings>;

export type Language = keyof typeof LANGUAGES;
export const DEFAULT_LANGUAGE: Language = 'en';

/** The texts of one language, outside the running bot (as for the manifest). */
export function stringsIn(language: Language, names: Names): Strings {
  return LANGUAGES[language](names);
}

export function isLanguage(value: string): value is Language {
  return Object.hasOwn(LANGUAGES, value);
}

/** The language of a Slack locale such as `es-ES`, or the default one if it isn't supported. */
export function languageOf(locale: string | undefined): Language {
  const language = locale?.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return isLanguage(language) ? language : DEFAULT_LANGUAGE;
}

/** Texts in each person's Slack language, and in the team's language for what the bot posts in the team channel. */
export class I18n {
  readonly team: Strings;
  #client: WebClient;
  #byLanguage: Record<Language, Strings>;
  #users = new Map<string, { language: Language; fetchedAt: number }>();
  #ttlMs: number;

  constructor(client: WebClient, names: Names, teamLanguage: Language, ttlMs = 60 * 60_000) {
    this.#client = client;
    this.#byLanguage = Object.fromEntries(
      Object.entries(LANGUAGES).map(([language, build]) => [language, build(names)]),
    ) as Record<Language, Strings>;
    this.team = this.#byLanguage[teamLanguage];
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
    return this.#byLanguage[await this.language(userId)];
  }

  in(language: Language): Strings {
    return this.#byLanguage[language];
  }
}
