import type { Strings } from '#src/i18n/index.ts';

/** The Slack error code (e.g. `not_in_channel`) when there is one. */
export function errorCode(error: unknown): string {
  const data = (error as { data?: { error?: unknown } }).data;
  if (typeof data?.error === 'string') return data.error;
  return error instanceof Error ? error.message : String(error);
}

/** Why Slack refused something, in words for the team when it is a common reason, or else its code. */
export function describeError(t: Strings, error: unknown): string {
  const code = errorCode(error);
  if (code === 'not_in_channel') return t.errors.notInChannel;
  if (code === 'is_archived') return t.errors.archived;
  if (code === 'channel_not_found') return t.errors.channelNotFound;
  if (code.startsWith('restricted_action')) return t.errors.restricted;
  if (code === 'user_disabled' || code === 'user_not_found') return t.errors.deactivated;
  if (code === 'cannot_dm_bot') return t.errors.bot;
  if (code === 'msg_too_long') return t.errors.tooLong;
  if (code === 'ratelimited') return t.errors.rateLimited;
  if (code === 'missing_scope') return t.errors.missingScope;
  return `\`${code}\``;
}
