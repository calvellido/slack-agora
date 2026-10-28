import type { WebClient } from '@slack/web-api';
import type { Deps } from './deps.ts';
import { compareVersions, parseVersion } from './lib/version.ts';
import type { Heartbeat } from './storage/heartbeat.ts';

// When the bot starts on another version than it last ran, it tells the team channel, with a link to what changed,
// as it tells it when it is back online.

/**
 * Keeps the version that is running, and if it isn't the one the bot last ran with this database, tells the team.
 * On the first start with the database, there is nothing to tell. From before versions were kept, `ranBefore` says
 * whether it is an update all the same, from an unknown version.
 */
export async function announceVersion(
  client: WebClient,
  { config, i18n, notices }: Pick<Deps, 'config' | 'i18n' | 'notices'>,
  heartbeat: Heartbeat,
  version: string,
  ranBefore: boolean,
): Promise<void> {
  const previous = heartbeat.lastVersion();
  heartbeat.ranVersion(version);
  if (previous === version || (previous === undefined && !ranBefore)) return;

  const t = i18n.team.notices;
  const [now, before] = [parseVersion(version), previous === undefined ? undefined : parseVersion(previous)];
  if (previous !== undefined && now && before && compareVersions(now, before) < 0) {
    await notices.post(client, { text: t.wentBack({ version, previous }) });
    return;
  }
  // A release's notes, where SOURCE_URL is a repository with releases, as Agora's is.
  const url = config.sourceUrl ? `${config.sourceUrl.replace(/\/+$/, '')}/releases/tag/v${version}` : '';
  const text = t.updated({ version, previous: previous ?? 'unknown', notes: url ? 'yes' : 'no', url });
  await notices.post(client, { text });
}
