import type { Logger } from '@slack/bolt';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, test } from 'node:test';
import { startMonitorPings } from './monitor.ts';

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The monitor's address answering `status`, with the calls and the log's warnings recorded. */
function setup(status = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => (calls.push(url), new Response('OK', { status }))) as typeof fetch;
  const warnings: string[] = [];
  const logger = { warn: (text: string) => warnings.push(text), info: () => {} } as unknown as Logger;
  const connection = new EventEmitter();
  const monitor = startMonitorPings('https://hc.example/secret', connection, logger, 10);
  return { calls, warnings, connection, monitor };
}

test('the monitor is called while the bot is connected to Slack, and not while it is not', async () => {
  const { calls, connection, monitor } = setup();
  await wait(25);
  assert.equal(calls.length, 0);

  connection.emit('connected');
  await wait(25);
  const whileConnected = calls.length;
  assert.ok(whileConnected >= 2);

  connection.emit('disconnected');
  await wait(25);
  assert.equal(calls.length, whileConnected);
  monitor.stop();
});

test("a monitor that can't be reached is logged once, without its secret address", async () => {
  const { warnings, connection, monitor } = setup(503);
  connection.emit('connected');
  await wait(35);
  monitor.stop();
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0]!.includes('secret'));
});
