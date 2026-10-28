import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { Activity, Span } from '#src/activity.ts';
import type { StatusInfo } from '#src/console/status.ts';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { formatDuration } from '#src/lib/time.ts';

// The team's button on the Home tab to see how the bot is doing, as the console's status says. It only shows: what
// changes something (the log's level, restarting, updating) stays in the bot's terminal. And it shows less than the
// console: of what failed, only how many and the last error code, since when an anonymous message failed to arrive
// is something Slack doesn't otherwise know, and whoever controls a team member's account would learn it here.

export const STATUS_ACTION = 'status_open';
const REFRESH_ACTION = 'status_refresh';

export function statusView(t: Strings, activity: Activity, info: StatusInfo, now: number): ModalView {
  const s = t.home.team.status;
  const ago = (at: number) => formatDuration(now - at);
  const span = (count: number, last: Span | undefined) => ({
    count,
    duration: last ? formatDuration(last.ms) : '',
    ago: last ? ago(last.at) : '',
  });
  const { connectedSince, lastFailure, lastPing } = activity;
  const { missingScopes } = info;
  const fields = [
    s.running({ version: info.version, node: info.node, duration: formatDuration(now - activity.startedAt) }),
    connectedSince === undefined ? s.notConnected : s.connected({ duration: ago(connectedSince), reconnections: activity.reconnections }),
    s.sleeps(span(activity.sleeps, activity.lastSleep)),
    s.losses(span(activity.losses, activity.lastLoss)),
    s.relayedLate({ count: activity.relayedLate, ago: activity.lastRelayedLate ? ago(activity.lastRelayedLate) : '' }),
    s.requests({ handled: String(activity.handled), failed: activity.failed, code: lastFailure?.code ?? '' }),
    !info.monitor ? s.monitorNone : !lastPing ? s.monitorWaiting : s.monitor({ ok: lastPing.ok ? 'yes' : 'no', ago: ago(lastPing.at) }),
    missingScopes === undefined
      ? s.permissionsUnknown
      : missingScopes.length === 0
        ? s.permissions
        : s.permissionsMissing({ scopes: missingScopes.map((scope) => `\`${scope}\``).join(', ') }),
    s.log({ level: info.level }),
    s.memory({ megabytes: String(Math.round(info.memoryBytes / 1024 / 1024)) }),
  ];
  return {
    type: 'modal',
    title: { type: 'plain_text', text: s.title },
    close: { type: 'plain_text', text: t.common.close },
    blocks: [
      { type: 'section', fields: fields.map((text) => ({ type: 'mrkdwn', text })) },
      { type: 'actions', elements: [{ type: 'button', action_id: REFRESH_ACTION, text: { type: 'plain_text', text: s.refresh } }] },
    ],
  };
}

/** For whoever is no longer in the team, since their Home tab was published. */
function teamOnlyView(t: Strings): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: t.home.team.status.title },
    close: { type: 'plain_text', text: t.common.close },
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: t.publish.teamOnly } }],
  };
}

export function registerStatus(app: App, { team, i18n, activity }: Pick<Deps, 'team' | 'i18n' | 'activity'>, info: () => StatusInfo): void {
  const view = async (user: string) => {
    const t = await i18n.forUser(user);
    return (await team.isMember(user)) ? statusView(t, activity, info(), Date.now()) : teamOnlyView(t);
  };

  app.action<BlockAction<ButtonAction>>(STATUS_ACTION, async ({ ack, body, client }) => {
    await ack();
    await client.views.open({ trigger_id: body.trigger_id, view: await view(body.user.id) });
  });

  app.action<BlockAction<ButtonAction>>(REFRESH_ACTION, async ({ ack, body, client }) => {
    await ack();
    if (body.view?.id) await client.views.update({ view_id: body.view.id, view: await view(body.user.id) });
  });
}
