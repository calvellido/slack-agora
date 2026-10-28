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

/**
 * Among release tags (v1.2.3), the newest with the same major version as `current`, if newer, and the newest with a
 * later major version, if any; as versions, without the v.
 */
export function newerReleases(tags: readonly string[], current: string): { next?: string; major?: string } {
  const now = parseVersion(current);
  if (!now) return {};
  const newer = tags
    .map(parseVersion)
    .filter((v): v is Version => v !== undefined && compareVersions(v, now) > 0)
    .sort((a, b) => compareVersions(b, a));
  const name = (v: Version | undefined) => v?.join('.');
  return { next: name(newer.find((v) => v[0] === now[0])), major: name(newer.find((v) => v[0] > now[0])) };
}
