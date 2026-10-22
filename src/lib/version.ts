import { readFileSync } from 'node:fs';

/** The version of Agora that is running, from package.json, which `pnpm version` keeps up to date. */
export const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
