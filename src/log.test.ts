import { LogLevel } from '@slack/bolt';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Log, type Level } from './log.ts';

/** A log at `level`, with the lines it writes recorded. */
function recorded(level: Level) {
  const lines: string[] = [];
  const log = new Log(level);
  log.write = (line) => lines.push(line);
  const logAll = () => {
    log.error('an error');
    log.warn('a warning');
    log.info('news');
    log.trace('an event');
    log.debug('a whole message');
  };
  return { log, lines, logAll };
}

test("each level logs its lines and the more important ones, and trace adds its own to info's", () => {
  const cases: [Level, string[]][] = [
    [LogLevel.WARN, ['[ERROR] an error', '[WARN] a warning']],
    [LogLevel.INFO, ['[ERROR] an error', '[WARN] a warning', '[INFO] news']],
    ['trace', ['[ERROR] an error', '[WARN] a warning', '[INFO] news', '[TRACE] an event']],
  ];
  for (const [level, expected] of cases) {
    const { lines, logAll } = recorded(level);
    logAll();
    assert.deepEqual(lines, expected, level);
  }
});

test('to Bolt and the Slack clients, trace is info, and their setting info keeps it', () => {
  const { log } = recorded('trace');
  assert.equal(log.getLevel(), LogLevel.INFO);
  log.setLevel(LogLevel.INFO);
  assert.equal(log.level, 'trace');
  log.setLevel(LogLevel.WARN);
  assert.equal(log.level, LogLevel.WARN);
});
