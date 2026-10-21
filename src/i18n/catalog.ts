import { readdirSync, readFileSync } from 'node:fs';
import { TYPE, parse, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { parse as parseYaml } from 'yaml';

// The texts, in locales/<language>.yml: nested keys whose values are ICU MessageFormat messages. Code reaches them
// through the Strings type generated from the English file (see generate.ts).

export const LOCALES_DIR = new URL('../../locales/', import.meta.url);
export const DEFAULT_LANGUAGE = 'en';

/** Values every message can use, filled in from the bot's name and commands, so callers never pass them. */
export const GLOBALS = ['bot', 'publishCommand', 'anonymousCommand'] as const;

/** A language's messages, by dotted key such as `anonymous.team.endConfirm`. */
export type Catalog = Map<string, string>;

/** The languages with a file in locales/, English first. */
export function availableLanguages(dir: URL = LOCALES_DIR): string[] {
  const found = readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => name.slice(0, -'.yml'.length));
  return [DEFAULT_LANGUAGE, ...found.filter((l) => l !== DEFAULT_LANGUAGE).sort()];
}

export function loadCatalog(language: string, dir: URL = LOCALES_DIR): Catalog {
  return catalogFrom(parseYaml(readFileSync(new URL(`${language}.yml`, dir), 'utf8')), `${language}.yml`);
}

/** Flattens a parsed locale file into dotted keys. Every leaf must be a string. */
export function catalogFrom(tree: unknown, source = 'locale'): Catalog {
  const catalog: Catalog = new Map();
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === 'string') {
      catalog.set(path.join('.'), node);
    } else if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
    } else {
      throw new Error(`${source}: ${path.join('.') || '(root)'} must be a text or a group of texts`);
    }
  };
  walk(tree ?? {}, []);
  return catalog;
}

export type ParamType = 'string' | 'number';

/** The ICU parser, set up as the formatter is: Slack's <@user> and <url|text> are text, not tags. */
export function parseMessage(message: string): MessageFormatElement[] {
  return parse(message, { ignoreTag: true, requiresOtherClause: true });
}

/** The values a message takes, and their types: plurals and numbers take numbers, the rest text. */
export function messageParams(message: string): Map<string, ParamType> {
  const params = new Map<string, ParamType>();
  const add = (name: string, type: ParamType) => params.set(name, params.get(name) === 'number' ? 'number' : type);
  const walk = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      if (element.type === TYPE.argument || element.type === TYPE.select) add(element.value, 'string');
      if (element.type === TYPE.number || element.type === TYPE.plural) add(element.value, 'number');
      if (element.type === TYPE.select || element.type === TYPE.plural) {
        for (const option of Object.values(element.options)) walk(option.value);
      }
    }
  };
  walk(parseMessage(message));
  return params;
}

/** A message's own values, leaving out the GLOBALS the formatter adds. */
export function callerParams(message: string): Map<string, ParamType> {
  const params = messageParams(message);
  for (const name of GLOBALS) params.delete(name);
  return params;
}
