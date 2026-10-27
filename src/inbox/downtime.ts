import type { Logger } from '@slack/bolt';
import type { ConversationsHistoryResponse, WebClient } from '@slack/web-api';
import type { Deps } from '#src/deps.ts';
import { formatDuration } from '#src/lib/time.ts';
import { slackDate } from '#src/slack/blocks.ts';
import { followConnection, type Connection } from '#src/slack/connection.ts';
import { errorCode } from '#src/slack/errors.ts';
import type { Heartbeat } from '#src/storage/heartbeat.ts';
import type { Dms } from './dms.ts';

// While the bot is down nobody receives Slack's events, and DMs sent meanwhile would be lost. The bot writes a
// heartbeat to its database every minute; on start, it relays the DMs it never marked as received since then, and
// tells the team how long it was away. It does the same while running, when its machine wakes from sleep or its
// connection to Slack comes back.

export type HistoryMessage = NonNullable<ConversationsHistoryResponse['messages']>[number];

export const HEARTBEAT_MS = 60_000;

/** The reaction the bot adds to every DM it has relayed, which also marks what is left to catch up. */
export const RECEIVED_EMOJI = 'incoming_envelope';

/** Past this, the team is told the bot is back even if no DM arrived meanwhile; shorter is a restart or a deploy. */
export const NOTICE_AFTER_MS = 5 * 60_000;

/**
 * A connection to Slack lost for less than this, as when Slack renews it every so often, loses no DMs: Slack sends an
 * event again for a few minutes when it couldn't deliver it.
 */
export const CATCH_UP_AFTER_MS = 60_000;

/** A tick of the minute's timer this late means the machine was asleep: timers stop while it sleeps, the clock doesn't. */
export const SLEPT_AFTER_MS = 60_000;

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
  /**
   * Writes a last heartbeat and stops; for a clean shutdown. With `missingSince`, when DMs from then on weren't caught
   * up yet, the heartbeat says the bot was last alive then, so the next start catches them up.
   */
  stop(missingSince?: number): void;
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
    stop(missingSince) {
      clearInterval(timer);
      heartbeat.beat(missingSince);
    },
  };
}

/** Relays the DMs sent while the bot was down, and tells the team it is back if it was away for a while. */
export async function recoverDowntime(client: WebClient, deps: Deps, dms: Dms, uptime: Uptime): Promise<void> {
  const { lastAlive, startedAt } = uptime;
  if (!lastAlive) return;
  const recovered = await dms.catchUp(client, lastAlive);
  await tellBack(client, deps, lastAlive, startedAt, recovered);
}

/** What catchUpWhileRunning returns. */
export interface Gaps {
  stop(): void;
  /** Since when DMs may be missing and no catch-up covered them yet, for the last heartbeat; undefined if none. */
  missingSince(): number | undefined;
}

/**
 * Catches up while the bot runs, as recoverDowntime does on start: when the machine sleeps, or the connection to Slack
 * is lost for a while, the bot keeps running but Slack's events from meanwhile never arrive. After a sleep, the
 * connection can look open until the client notices it isn't, so the catch-up waits for a tick on time, or for Slack
 * to connect again. A catch-up that fails is tried again on the next tick.
 */
export function catchUpWhileRunning(
  client: WebClient,
  deps: Deps,
  dms: Dms,
  connection: Connection,
  logger: Logger,
  clock = { everyMs: HEARTBEAT_MS, now: Date.now },
): Gaps {
  const { everyMs, now } = clock;
  let connected = false;
  // Retries before the first connection aren't a lost connection: recoverDowntime covers the time until then.
  let everConnected = false;
  let lostAt: number | undefined;
  // Since when DMs may be missing, until a catch-up covers them, and since when for the catch-up running.
  let missingSince: number | undefined;
  let catchingUpSince: number | undefined;
  // Logged once, until a catch-up works again.
  let failing = false;
  const missing = (since: number) => {
    missingSince = Math.min(missingSince ?? since, since);
  };

  async function catchUp() {
    if (catchingUpSince !== undefined || missingSince === undefined) return;
    const since = (catchingUpSince = missingSince);
    missingSince = undefined;
    let recovered: number;
    try {
      recovered = await dms.catchUp(client, since);
      failing = false;
    } catch (error) {
      if (!failing) logger.error(`Catching up failed, and it will be tried again: ${errorCode(error)}`);
      failing = true;
      missing(since);
      return;
    } finally {
      catchingUpSince = undefined;
    }
    // The DMs are relayed: a note that can't be posted isn't worth catching up again.
    await tellBack(client, deps, since, now(), recovered).catch((error) => {
      logger.error(`Telling the team the bot is back failed: ${errorCode(error)}`);
    });
  }

  followConnection(
    connection,
    () => {
      connected = true;
      everConnected = true;
      if (lostAt !== undefined && now() - lostAt >= CATCH_UP_AFTER_MS) {
        logger.warn(`The connection to Slack was lost for ${formatDuration(now() - lostAt)}`);
        missing(lostAt);
      }
      lostAt = undefined;
      void catchUp();
    },
    () => {
      connected = false;
      if (everConnected) lostAt ??= now();
    },
  );

  let lastTick = now();
  const timer = setInterval(() => {
    const tick = now();
    const late = tick - lastTick - everyMs;
    if (late >= SLEPT_AFTER_MS) {
      logger.warn(`The machine was asleep for about ${formatDuration(late)}`);
      missing(lastTick);
    } else if (connected) {
      void catchUp();
    }
    lastTick = tick;
  }, everyMs);
  return {
    stop: () => clearInterval(timer),
    missingSince() {
      const since = [missingSince, catchingUpSince, lostAt].filter((at) => at !== undefined);
      return since.length > 0 ? Math.min(...since) : undefined;
    },
  };
}

/** Tells the team the bot is back after being away from `away` to `back` (ms), if that was a while or it relayed DMs. */
async function tellBack(client: WebClient, { i18n, notices }: Deps, away: number, back: number, recovered: number): Promise<void> {
  if (recovered === 0 && back - away < NOTICE_AFTER_MS) return;
  const since = slackDate(String(away / 1000));
  const text = i18n.team.inbox.backOnline({ duration: formatDuration(back - away), since, recovered });
  await notices.post(client, { text });
}
