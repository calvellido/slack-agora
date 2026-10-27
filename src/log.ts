import { LogLevel, type Logger } from '@slack/bolt';
import { format } from 'node:util';

// The bot's log, shared by Bolt, the Socket Mode client and the Web API clients, so that its level can change while
// the bot runs, from the console. Lines go to stdout, and warnings and errors to stderr, as with Bolt's own logger.

/**
 * Bolt's levels, and `trace`: what `info` logs, plus a line for each event, action or command the bot handles, with
 * its name and how it ended, but no IDs or text. Bolt's `debug` prints whole messages, with names.
 */
export type Level = LogLevel | 'trace';

/** From the least to the most that is logged. */
export const LEVELS: readonly Level[] = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, 'trace', LogLevel.DEBUG];

export class Log implements Logger {
  /** The level, which can be `trace`. */
  level: Level;
  /** Writes a line; the console replaces it, to print lines above what is being typed. */
  write: (line: string, stream: NodeJS.WriteStream) => void = (line, stream) => void stream.write(`${line}\n`);

  constructor(level: Level = LogLevel.INFO) {
    this.level = level;
  }

  // The Logger interface, for Bolt and the Slack clients, which only know their own levels: to them, trace is info.
  getLevel(): LogLevel {
    return this.level === 'trace' ? LogLevel.INFO : this.level;
  }

  setLevel(level: LogLevel): void {
    if (level !== this.getLevel()) this.level = level;
  }

  /** One log for all of them, so without their names. */
  setName(): void {}

  debug(...msg: unknown[]): void {
    this.#log(LogLevel.DEBUG, process.stdout, msg);
  }

  trace(...msg: unknown[]): void {
    this.#log('trace', process.stdout, msg);
  }

  info(...msg: unknown[]): void {
    this.#log(LogLevel.INFO, process.stdout, msg);
  }

  warn(...msg: unknown[]): void {
    this.#log(LogLevel.WARN, process.stderr, msg);
  }

  error(...msg: unknown[]): void {
    this.#log(LogLevel.ERROR, process.stderr, msg);
  }

  #log(level: Level, stream: NodeJS.WriteStream, msg: unknown[]): void {
    if (LEVELS.indexOf(level) > LEVELS.indexOf(this.level)) return;
    this.write(`[${level.toUpperCase()}] ${format(...msg)}`, stream);
  }
}
