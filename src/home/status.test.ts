import { LogLevel, type App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Activity } from '#src/activity.ts';
import type { StatusInfo } from '#src/console/status.ts';
import type { Deps } from '#src/deps.ts';
import { I18n, stringsIn } from '#src/i18n/index.ts';
import { STATUS_ACTION, registerStatus, statusView } from './status.ts';

const names = { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' };
const t = stringsIn('en', names);
const s = t.home.team.status;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const info: StatusInfo = { version: '3.5.0', node: '26.12.1', level: LogLevel.INFO, monitor: true, missingScopes: [], memoryBytes: 80 * 1024 * 1024 };
const fields = (view: { blocks: unknown[] }) =>
  (view.blocks[0] as { fields: { text: string }[] }).fields.map((f) => f.text);

/** A bot that started 3 hours ago, slept for an hour, relayed 2 DMs late, and handled 2 things from Slack, one failing. */
function busyActivity() {
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
  return activity;
}

test("the status window says how the bot is doing, as the console's status does, in the team's words", () => {
  const view = statusView(t, busyActivity(), info, 3 * HOUR);
  assert.deepEqual(fields(view), [
    s.running({ version: '3.5.0', node: '26.12.1', duration: '3 h' }),
    s.connected({ duration: '1 h', reconnections: 1 }),
    s.sleeps({ count: 1, duration: '1 h', ago: '1 h' }),
    s.losses({ count: 0, duration: '', ago: '' }),
    s.relayedLate({ count: 2, ago: '1 h' }),
    s.requests({ handled: '2', failed: 1, code: 'not_in_channel' }),
    s.monitor({ ok: 'yes', ago: '1 h' }),
    s.permissions,
    s.log({ level: 'info' }),
    s.memory({ megabytes: '80' }),
  ]);
  assert.equal(fields(view)[2], '*Sleeps*\n1, for about 1 h, ending 1 h ago');
});

test('of what failed, Slack only gets how many and the last error code, never what it was', () => {
  const view = JSON.stringify(statusView(t, busyActivity(), info, 3 * HOUR));
  assert.ok(view.includes('not_in_channel'));
  assert.ok(!view.includes('anon_message'));
  assert.ok(!view.includes('anon_open'));
});

test('the window says when permissions are missing, and when there is no monitor', () => {
  const view = statusView(t, new Activity(() => 0), { ...info, monitor: false, missingScopes: ['im:read', 'emoji:read'] }, MINUTE);
  assert.ok(fields(view).includes(s.notConnected));
  assert.ok(fields(view).includes(s.monitorNone));
  assert.ok(fields(view).includes(s.permissionsMissing({ scopes: '`im:read`, `emoji:read`' })));
});

/** The buttons' handlers, with the windows they open and update recorded. */
function setup(member = true) {
  const opened: unknown[] = [];
  const updated: unknown[] = [];
  const client = {
    views: {
      open: async ({ view }: { view: unknown }) => (opened.push(view), {}),
      update: async ({ view }: { view: unknown }) => (updated.push(view), {}),
    },
    users: { info: async () => ({ user: { locale: 'en-US' } }) },
  } as unknown as WebClient;
  const handlers: Record<string, (args: unknown) => Promise<void>> = {};
  const app = { action: (id: string, h: (args: unknown) => Promise<void>) => (handlers[id] = h) } as unknown as App;
  const deps = { team: { isMember: async () => member }, i18n: new I18n(client, names, 'en'), activity: new Activity() } as unknown as Deps;
  registerStatus(app, deps, () => info);
  const press = (id: string) =>
    handlers[id]!({ ack: async () => {}, body: { user: { id: 'U1' }, trigger_id: 'T1', view: { id: 'V1' } }, client });
  return { opened, updated, press };
}

test('the button opens the status, and its refresh button shows it again as it is now', async () => {
  const { opened, updated, press } = setup();
  await press(STATUS_ACTION);
  assert.ok(fields(opened[0] as never).includes(s.log({ level: 'info' })));
  await press('status_refresh');
  assert.ok(fields(updated[0] as never).includes(s.log({ level: 'info' })));
});

test('someone no longer in the team gets told it is only for the team, without the status', async () => {
  const { opened, press } = setup(false);
  await press(STATUS_ACTION);
  const view = JSON.stringify(opened[0]);
  assert.ok(view.includes(t.publish.teamOnly));
  assert.ok(!view.includes('3.5.0'));
});
