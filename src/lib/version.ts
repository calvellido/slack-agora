import { readFileSync } from 'node:fs';

/** The version of Agora that is running, from package.json, which `pnpm version` keeps up to date. */
export const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export type Version = [number, number, number];

/** A version such as 1.2.3, or a release tag such as v1.2.3. */
export function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** Negative if `a` comes before `b`, positive if after, 0 if they are the same. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
