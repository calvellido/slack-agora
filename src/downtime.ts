import type { ConversationsHistoryResponse } from '@slack/web-api';

// While the bot is down nobody receives Slack's events, and DMs sent meanwhile would be lost. The bot writes a
// heartbeat to its database every minute; on start, it relays the DMs it never marked as received since then, and
// tells the team how long it was away.

export type HistoryMessage = NonNullable<ConversationsHistoryResponse['messages']>[number];

export const HEARTBEAT_MS = 60_000;

/** The reaction the bot adds to every DM it has relayed, which also marks what is left to catch up. */
export const RECEIVED_EMOJI = 'incoming_envelope';

/** Past this, the team is told the bot is back even if no DM arrived meanwhile; shorter is a restart or a deploy. */
export const NOTICE_AFTER_MS = 5 * 60_000;

/** DMs from people the bot hasn't marked as received, oldest first. */
export function missedDms(messages: readonly HistoryMessage[], botUserId: string): HistoryMessage[] {
  return messages
    .filter((m) => m.ts && m.user && m.user !== botUserId && !m.bot_id)
    .filter((m) => m.subtype === undefined || m.subtype === 'file_share')
    .filter((m) => !m.reactions?.some((r) => r.name === RECEIVED_EMOJI && r.users?.includes(botUserId)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

/** A rough duration such as `3 min`, `2 h 14 min` or `4 d 1 h`, readable in English and Spanish alike. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}
