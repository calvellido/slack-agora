import type { Activity, Span } from '#src/activity.ts';
import { formatDuration } from '#src/lib/time.ts';
import type { Level } from '#src/log.ts';

/** What the status shows besides the activity. */
export interface StatusInfo {
  version: string;
  node: string;
  level: Level;
  /** Whether HEARTBEAT_URL is set. */
  monitor: boolean;
  /** The permissions the token lacked when the bot started, or undefined if Slack didn't say. */
  missingScopes?: string[];
  memoryBytes: number;
}

const times = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The console's `status`: how the bot is doing, in counts and times, without who or what. */
export function statusLines(activity: Activity, info: StatusInfo, now: number): string[] {
  const ago = (at: number) => `${formatDuration(now - at)} ago`;
  const last = (count: number, span: Span | undefined) =>
    count === 0 || !span ? 'none' : `${count}, the last for about ${formatDuration(span.ms)}, ending ${ago(span.at)}`;
  const { connectedSince, lastFailure, lastPing } = activity;
  const { missingScopes } = info;

  const slack =
    connectedSince === undefined
      ? 'not connected'
      : `connected for ${formatDuration(now - connectedSince)}, and ${times(activity.reconnections, 'reconnection')} since starting`;
  const relayed = activity.relayedLate === 0 ? 'none' : `${activity.relayedLate}, the last ${ago(activity.lastRelayedLate!)}`;
  const failed = lastFailure ? `${activity.failed} failed, the last ${ago(lastFailure.at)}: ${lastFailure.what} (${lastFailure.code})` : 'none failed';
  const monitor = !info.monitor
    ? 'none (HEARTBEAT_URL)'
    : !lastPing
      ? 'not called yet'
      : `the last call ${lastPing.ok ? 'worked' : 'failed'}, ${ago(lastPing.at)}`;
  const permissions =
    missingScopes === undefined
      ? "unknown: Slack didn't say"
      : missingScopes.length === 0
        ? 'all there'
        : `missing ${missingScopes.join(', ')} when the bot started: generate the manifest again, paste it in the app's settings, and restart the bot`;

  return [
    `Agora ${info.version} on Node ${info.node}, running for ${formatDuration(now - activity.startedAt)}`,
    `Slack: ${slack}`,
    `Sleeps: ${last(activity.sleeps, activity.lastSleep)}`,
    `Lost connections: ${last(activity.losses, activity.lastLoss)}`,
    `DMs relayed late: ${relayed}`,
    `From Slack: ${activity.handled} handled, ${failed}`,
    `Monitor: ${monitor}`,
    `Permissions: ${permissions}`,
    `Log level: ${info.level}`,
    `Memory: ${Math.round(info.memoryBytes / 1024 / 1024)} MB`,
  ];
}
