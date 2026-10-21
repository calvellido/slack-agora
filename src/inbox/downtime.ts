import type { ConversationsHistoryResponse, WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { formatDuration } from '#src/lib/time.ts';
import { slackDate } from '#src/slack/blocks.ts';
import type { Heartbeat } from '#src/storage/heartbeat.ts';
import type { Dms } from './dms.ts';

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

export interface Uptime {
  /** When the bot was last running before this start; undefined on its very first start with this database. */
  lastAlive?: number;
  startedAt: number;
  /** Writes a last heartbeat and stops; for a clean shutdown. */
  stop(): void;
}

/** Writes a heartbeat now and every minute after, and reports when the bot was last alive before. */
export function startHeartbeat(heartbeat: Heartbeat): Uptime {
  const lastAlive = heartbeat.last();
  const startedAt = Date.now();
  heartbeat.beat(startedAt);
  const timer = setInterval(() => heartbeat.beat(), HEARTBEAT_MS);
  return {
    lastAlive,
    startedAt,
    stop() {
      clearInterval(timer);
      heartbeat.beat();
    },
  };
}

/** Relays the DMs sent while the bot was down, and tells the team it is back if it was away for a while. */
export async function recoverDowntime(client: WebClient, { i18n, notices }: Deps, dms: Dms, uptime: Uptime): Promise<void> {
  const { lastAlive, startedAt } = uptime;
  if (!lastAlive) return;
  const recovered = await dms.catchUp(client, lastAlive);
  if (recovered === 0 && startedAt - lastAlive < NOTICE_AFTER_MS) return;
  const since = slackDate(String(lastAlive / 1000));
  const text = i18n.team.inbox.backOnline({ duration: formatDuration(startedAt - lastAlive), since, recovered });
  await notices.post(client, { text });
}
