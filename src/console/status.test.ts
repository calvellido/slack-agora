import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Activity } from '#src/activity.ts';
import { consoleCommands } from './commands.ts';
import { Log } from '#src/log.ts';
import { statusLines, type StatusInfo } from './status.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const info: StatusInfo = { version: '3.1.0', node: '26.12.1', level: 'trace', monitor: true, missingScopes: [], memoryBytes: 80 * 1024 * 1024 };

test('the status says how the bot is doing, in counts and times', () => {
  let now = 0;
  const activity = new Activity(() => now);
  now = 2 * HOUR;
  activity.slept(HOUR);
  activity.caughtUp(2);
  activity.connectedSince = 2 * HOUR;
  activity.reconnections = 1;
  activity.handledRequest('action anon_open');
  activity.handledRequest('form anon_message', 'not_in_channel');
  activity.pinged(true);
  now = 3 * HOUR;

  assert.deepEqual(statusLines(activity, info, now), [
    'Agora 3.1.0 on Node 26.12.1, running for 3 h',
    'Slack: connected for 1 h, and 1 reconnection since starting',
    'Sleeps: 1, the last for about 1 h, ending 1 h ago',
    'Lost connections: none',
    'DMs relayed late: 2, the last 1 h ago',
    'From Slack: 2 handled, 1 failed, the last 1 h ago: form anon_message (not_in_channel)',
    'Monitor: the last call worked, 1 h ago',
    'Permissions: all there',
    'Log level: trace',
    'Memory: 80 MB',
  ]);
});

test('the status says when permissions are missing, and when there is no monitor', () => {
  const activity = new Activity(() => 0);
  const lines = statusLines(activity, { ...info, monitor: false, missingScopes: ['im:read'] }, MINUTE);
  assert.ok(lines.includes('Slack: not connected'));
  assert.ok(lines.includes('Monitor: none (HEARTBEAT_URL)'));
  assert.ok(lines.includes("Permissions: missing im:read when the bot started: generate the manifest again, paste it in the app's settings, and restart the bot"));
});

test("the log's level changes from the console, but not to debug, which prints whole messages", async () => {
  const log = new Log();
  const commands = consoleCommands({ log, activity: new Activity(), info: () => info });
  const say = () => {};
  assert.equal(await commands.log!.run(['trace'], say), "The log's level is trace until the bot stops, with a line for each event, action or command, without names or text");
  assert.equal(log.level, 'trace');
  assert.match(String(await commands.log!.run(['debug'], say)), /^Not from here/);
  assert.match(String(await commands.log!.run(['loud'], say)), /^There's no level loud/);
  assert.equal(log.level, 'trace');
});

test('restarting and applying an update need the launcher of pnpm start', async () => {
  const say = () => {};
  const without = consoleCommands({ log: new Log(), activity: new Activity(), info: () => info });
  assert.match(String(await without.restart!.run([], say)), /^Only when the bot was started with pnpm start/);
  assert.match(String(await without.update!.run(['apply'], say)), /^Only when the bot was started with pnpm start/);

  let restarts = 0;
  const said: string[] = [];
  const launched = consoleCommands({ log: new Log(), activity: new Activity(), info: () => info, restart: () => restarts++ });
  await launched.restart!.run([], (line) => said.push(line));
  assert.deepEqual(said, ['Restarting…']);
  assert.equal(restarts, 1);
});
