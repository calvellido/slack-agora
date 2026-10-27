import type { App } from '@slack/bolt';
import type { Log } from './log.ts';
import { followConnection, type Connection } from './slack/connection.ts';
import { errorCode } from './slack/errors.ts';

// What the bot has done since it started, for the console's status: counts and times only, never who or what, and
// only in memory. The parts that do something report it here.

/** Something that ended `at`, after lasting `ms`. */
export interface Span {
  at: number;
  ms: number;
}

export class Activity {
  readonly startedAt: number;
  #now: () => number;
  /** Since when the bot is connected to Slack; undefined while it isn't. */
  connectedSince?: number;
  /** Short ones too, as when Slack renews the connection every so often. */
  reconnections = 0;
  sleeps = 0;
  lastSleep?: Span;
  /** Connections to Slack lost for long enough to catch up after them. */
  losses = 0;
  lastLoss?: Span;
  /** DMs relayed late, by the catch-ups after the bot was away. */
  relayedLate = 0;
  lastRelayedLate?: number;
  /** What Slack sent: events, actions, commands, shortcuts and forms. */
  handled = 0;
  failed = 0;
  lastFailure?: { at: number; what: string; code: string };
  /** The monitor's last call. */
  lastPing?: { at: number; ok: boolean };

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.startedAt = now();
  }

  watch(connection: Connection): void {
    let first = true;
    followConnection(
      connection,
      () => {
        this.connectedSince = this.#now();
        if (!first) this.reconnections++;
        first = false;
      },
      () => (this.connectedSince = undefined),
    );
  }

  slept(ms: number): void {
    this.sleeps++;
    this.lastSleep = { at: this.#now(), ms };
  }

  lostConnection(ms: number): void {
    this.losses++;
    this.lastLoss = { at: this.#now(), ms };
  }

  caughtUp(relayed: number): void {
    if (relayed === 0) return;
    this.relayedLate += relayed;
    this.lastRelayedLate = this.#now();
  }

  pinged(ok: boolean): void {
    this.lastPing = { at: this.#now(), ok };
  }

  /** `code` is the error's, for what failed. */
  handledRequest(what: string, code?: string): void {
    this.handled++;
    if (code === undefined) return;
    this.failed++;
    this.lastFailure = { at: this.#now(), what, code };
  }
}

/** The fields of what Slack sends that name it. */
interface Request {
  type?: string;
  event?: { type?: string; subtype?: string; channel_type?: string };
  command?: string;
  actions?: { action_id?: string }[];
  view?: { callback_id?: string };
  callback_id?: string;
  action_id?: string;
}

/**
 * What Slack sent, by the names the code gives it (event types, commands, action and callback IDs), which say what
 * happened but not who or where: `event message/file_share (im)`, `action anon_open`, `form anon_message`.
 */
export function describeRequest(body: Request): string {
  if (body.event) {
    const { type, subtype, channel_type } = body.event;
    return `event ${type}${subtype ? `/${subtype}` : ''}${channel_type ? ` (${channel_type})` : ''}`;
  }
  if (body.command) return `command ${body.command}`;
  switch (body.type) {
    case 'block_actions':
      return `action ${body.actions?.[0]?.action_id}`;
    case 'view_submission':
      return `form ${body.view?.callback_id}`;
    case 'view_closed':
      return `form ${body.view?.callback_id} closed`;
    case 'shortcut':
    case 'message_action':
      return `shortcut ${body.callback_id}`;
    case 'block_suggestion':
      return `options ${body.action_id}`;
    default:
      return body.type ?? 'unknown request';
  }
}

/**
 * Counts what Slack sends the bot and how it ends, and at the `trace` level logs a line for each, with how long it
 * took. Errors go on to the app's error handler, which logs them.
 */
export function watchRequests(app: App, activity: Activity, log: Log): void {
  app.use(async ({ body, next }) => {
    const what = describeRequest(body as Request);
    const started = performance.now();
    const took = () => `${Math.round(performance.now() - started)} ms`;
    try {
      await next();
    } catch (error) {
      const code = errorCode(error);
      activity.handledRequest(what, code);
      log.trace(`${what}: failed after ${took()} (${code})`);
      throw error;
    }
    activity.handledRequest(what);
    log.trace(`${what}: ${took()}`);
  });
}
