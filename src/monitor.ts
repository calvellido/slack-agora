import type { Logger } from '@slack/bolt';
import { errorCode } from './slack/errors.ts';

/**
 * Calls HEARTBEAT_URL every `everyMs` (HEARTBEAT_MINUTES) while the bot is connected to Slack, for a monitor such as Healthchecks.io that
 * alerts someone when the calls stop: when the bot or its machine is down, or it lost its connection to Slack. The
 * calls go out, so nothing needs to reach the machine, and they say nothing but that the bot is up. The address is
 * a secret of the monitor, so it is never logged.
 */
export function startMonitorPings(
  url: string,
  connection: { on(state: string, listener: () => void): unknown },
  logger: Logger,
  everyMs = 60_000,
): { stop(): void } {
  let connected = false;
  let failing = false;

  async function ping() {
    if (!connected) return;
    try {
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      if (failing) logger.info('HEARTBEAT_URL can be reached again');
      failing = false;
    } catch (error) {
      // Once until it works again, so a monitor that is down doesn't fill the log.
      if (!failing) logger.warn(`Couldn't reach HEARTBEAT_URL (${errorCode(error)}): the monitor may alert that the bot is down`);
      failing = true;
    }
  }

  connection.on('connected', () => {
    connected = true;
    void ping();
  });
  for (const state of ['disconnecting', 'disconnected', 'reconnecting']) connection.on(state, () => (connected = false));
  const timer = setInterval(() => void ping(), everyMs);
  return { stop: () => clearInterval(timer) };
}
