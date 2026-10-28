import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { Deps } from '#src/deps.ts';
import type { Strings } from '#src/i18n/index.ts';
import { VERSION, newerReleases, parseVersion } from '#src/lib/version.ts';
import { context, modalTitle, slackTime } from '#src/slack/blocks.ts';
import { errorCode } from '#src/slack/errors.ts';

// The team's button on the Home tab to check for a newer release, among the releases of SOURCE_URL's repository on
// GitHub, which also works where the bot has no git clone, as in Docker. It only tells: the release is installed on
// the bot's machine, never from Slack, where whoever controls a team member's account, the workspace's owner among
// them, could otherwise change the code running next to the anonymity secret.

export const UPDATES_ACTION = 'updates_check';

/** GitHub's answers are kept this long, as it allows 60 calls an hour without a token. */
const KEEP_MS = 10 * 60_000;

export interface Release {
  tag: string;
  url: string;
}

/** The `owner/name` of a repository on GitHub, from its address, or undefined if it isn't one. */
export function githubRepository(url: string | undefined): string | undefined {
  return url ? /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] : undefined;
}

/** GitHub refusing calls from this network for now, until `until` (ms): without a token it allows 60 an hour. */
export class RateLimited extends Error {
  readonly until: number;

  constructor(status: number, until: number) {
    super(`GitHub answered ${status}: this network's limit of calls is reached until ${new Date(until).toTimeString().slice(0, 5)}`);
    this.until = until;
  }
}

/** Until when GitHub refuses calls, if that is what its answer says, from its headers. */
export function rateLimitedUntil(response: Pick<Response, 'status' | 'headers'>, now = Date.now()): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined;
  // Calls too close together are told when to try again; too many in the hour, when the hour's count starts again.
  const retryAfter = Number(response.headers.get('retry-after'));
  if (retryAfter > 0) return now + retryAfter * 1000;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  return response.headers.get('x-ratelimit-remaining') === '0' && reset > 0 ? reset * 1000 : undefined;
}

/** Why a call failed: fetch's own error only says "fetch failed", and keeps the reason, such as a certificate, as its cause. */
function reason(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
  const why = cause?.code ?? cause?.message;
  return typeof why === 'string' ? `${errorCode(error)} (${why})` : errorCode(error);
}

/** The published releases of a GitHub repository, drafts and pre-releases left out. */
export async function githubReleases(repository: string): Promise<Release[]> {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Agora' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const until = rateLimitedUntil(response);
    throw until ? new RateLimited(response.status, until) : new Error(`GitHub answered ${response.status}`);
  }
  const releases = (await response.json()) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }[];
  return releases.filter((r) => !r.draft && !r.prerelease).map((r) => ({ tag: r.tag_name, url: r.html_url }));
}

/** What the window says: still checking, what it found, or that it couldn't, or that it is the team's alone. */
export type UpdateCheck =
  | { state: 'checking' }
  | { state: 'failed'; until?: number }
  | { state: 'teamOnly' }
  | { state: 'found'; next?: Release & { version: string }; major?: Release & { version: string } };

/** The newest release with the same major version as `current`, if newer, and the newest with a later one. */
export function newerOf(releases: readonly Release[], current: string): UpdateCheck {
  const { next, major } = newerReleases(
    releases.map((r) => r.tag),
    current,
  );
  const release = (version: string | undefined) => {
    const found = version && releases.find((r) => parseVersion(r.tag)?.join('.') === version);
    return found ? { ...found, version } : undefined;
  };
  return { state: 'found', next: release(next), major: release(major) };
}

export function updatesView(t: Strings, current: string, check: UpdateCheck): ModalView {
  const section = (text: string) => ({ type: 'section' as const, text: { type: 'mrkdwn' as const, text } });
  const u = t.home.team.updates;
  let blocks;
  if (check.state === 'teamOnly') blocks = [section(t.publish.teamOnly)];
  else if (check.state === 'checking') blocks = [section(u.checking)];
  else if (check.state === 'failed') blocks = [section(check.until ? u.rateLimited({ time: slackTime(check.until) }) : u.failed)];
  else {
    const { next, major } = check;
    blocks = [
      section(next ? u.newer({ current, next: next.version, url: next.url }) : u.latest({ current, major: current.split('.')[0]! })),
      ...(major ? [section(u.newMajor({ version: major.version, url: major.url }))] : []),
      ...(next || major ? [context(u.howTo)] : []),
    ];
  }
  return { type: 'modal', title: modalTitle(u.title), close: { type: 'plain_text', text: t.common.close }, blocks };
}

/** Whether the deployment's SOURCE_URL has releases the button can check, and so whether the Home tab shows it. */
export function canCheckForUpdates(sourceUrl: string | undefined): boolean {
  return githubRepository(sourceUrl) !== undefined;
}

export function registerUpdateCheck(
  app: App,
  { config, team, i18n }: Pick<Deps, 'config' | 'team' | 'i18n'>,
  releases: (repository: string) => Promise<Release[]> = githubReleases,
  current = VERSION,
): void {
  const repository = githubRepository(config.sourceUrl);
  if (!repository) return;
  // Kept for a while, unless GitHub couldn't be reached, so the next press asks again. A refusal for now is kept
  // until GitHub allows calls again, as asking before can't work.
  let kept: { until: number; releases: Promise<Release[]> } | undefined;
  const latest = () => {
    if (!kept || Date.now() > kept.until) {
      const asked = { until: Date.now() + KEEP_MS, releases: releases(repository) };
      asked.releases.catch((error: unknown) => {
        if (kept !== asked) return;
        if (error instanceof RateLimited) asked.until = error.until;
        else kept = undefined;
      });
      kept = asked;
    }
    return kept.releases;
  };

  app.action<BlockAction<ButtonAction>>(UPDATES_ACTION, async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const t = await i18n.forUser(user);
    // Checked again, in case they left the team since their Home tab was published.
    if (!(await team.isMember(user))) {
      await client.views.open({ trigger_id: body.trigger_id, view: updatesView(t, current, { state: 'teamOnly' }) });
      return;
    }
    // Slack waits only 3 seconds for the window to open, so it opens at once and says what it found after.
    const { view } = await client.views.open({ trigger_id: body.trigger_id, view: updatesView(t, current, { state: 'checking' }) });
    let check: UpdateCheck;
    try {
      check = newerOf(await latest(), current);
    } catch (error) {
      app.logger.warn(`Couldn't check for updates: ${reason(error)}`);
      check = { state: 'failed', until: error instanceof RateLimited ? error.until : undefined };
    }
    if (view?.id) await client.views.update({ view_id: view.id, view: updatesView(t, current, check) });
  });
}
