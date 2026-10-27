import type { App } from '@slack/bolt';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Activity, describeRequest, watchRequests } from './activity.ts';
import { Log } from './log.ts';
import { slackError } from './slack/testing.ts';

test('what Slack sends is named by what the code calls it, without who, where or what they wrote', () => {
  const dm = { type: 'event_callback', event: { type: 'message', subtype: 'file_share', channel_type: 'im', user: 'U1', text: 'Hola' } };
  const button = { type: 'block_actions', user: { id: 'U1' }, actions: [{ action_id: 'anon_open', value: 'handle' }] };
  const form = { type: 'view_submission', view: { callback_id: 'anon_message', state: { values: {} } } };
  const command = { command: '/agora-anon', text: 'something', user_id: 'U1' };
  const shortcut = { type: 'message_action', callback_id: 'publish_as_bot', message: { text: 'Hola' } };
  assert.equal(describeRequest(dm), 'event message/file_share (im)');
  assert.equal(describeRequest(button), 'action anon_open');
  assert.equal(describeRequest(form), 'form anon_message');
  assert.equal(describeRequest(command), 'command /agora-anon');
  assert.equal(describeRequest(shortcut), 'shortcut publish_as_bot');
});

test('the connection to Slack is followed, counting reconnections but not the first connection', () => {
  let now = 1000;
  const activity = new Activity(() => now);
  const connection = new EventEmitter();
  activity.watch(connection);
  connection.emit('connected');
  assert.equal(activity.connectedSince, 1000);

  now = 5000;
  connection.emit('reconnecting');
  assert.equal(activity.connectedSince, undefined);
  connection.emit('connected');
  assert.equal(activity.connectedSince, 5000);
  assert.equal(activity.reconnections, 1);
});

test('what Slack sends is counted, failures with their code, and the trace has a line for each', async () => {
  const activity = new Activity();
  const lines: string[] = [];
  const log = new Log('trace');
  log.write = (line) => lines.push(line);
  let middleware: (args: { body: unknown; next: () => Promise<void> }) => Promise<void> = async () => {};
  const app = { use: (m: typeof middleware) => (middleware = m) } as unknown as App;
  watchRequests(app, activity, log);

  const button = { type: 'block_actions', actions: [{ action_id: 'anon_open' }] };
  await middleware({ body: button, next: async () => {} });
  // The error goes on to the app's error handler.
  await assert.rejects(middleware({ body: button, next: async () => Promise.reject(slackError('not_in_channel')) }));

  assert.equal(activity.handled, 2);
  assert.equal(activity.failed, 1);
  assert.deepEqual({ ...activity.lastFailure, at: 0 }, { at: 0, what: 'action anon_open', code: 'not_in_channel' });
  assert.match(lines[0]!, /^\[TRACE\] action anon_open: \d+ ms$/);
  assert.match(lines[1]!, /^\[TRACE\] action anon_open: failed after \d+ ms \(not_in_channel\)$/);
});
