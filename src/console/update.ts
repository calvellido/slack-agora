import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareVersions, newerReleases, parseVersion } from '#src/lib/version.ts';

// The console's update: finding a newer release among the repository's tags, and installing it, in a folder cloned
// at a release as GUIDE.md installs it. Only within the same major version, as a new one can need changes by hand.

/** Runs a command in the bot's folder, and returns what it printed; it throws with what it said on stderr. */
export type Run = (command: string, args: string[]) => Promise<string>;

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Without the bot's terminal, which the console is reading: in a session of their own, git and ssh can't ask for a
 * password there, and fail instead, with the user's own ssh settings and agent working as usual.
 */
export const runInRoot: Run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      timeout: 5 * 60_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (data: string) => (stdout += data));
    child.stderr.setEncoding('utf8').on('data', (data: string) => (stderr += data));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(Object.assign(new Error(`${command} ${signal ? `stopped by ${signal}` : `exited with ${code}`}`), { stderr }));
    });
  });

/** The first line of what a failed command said. */
function said(error: unknown): string {
  const { stderr, message } = error as { stderr?: string; message?: string };
  return (stderr?.trim() || message || String(error)).split('\n')[0]!;
}

/** The changelog's sections for the versions after `from`, up to `to`, without the links at its end. */
export function notesBetween(changelog: string, from: string, to: string): string {
  const [after, upTo] = [parseVersion(from)!, parseVersion(to)!];
  const lines: string[] = [];
  let inside = false;
  for (const line of changelog.split('\n')) {
    const heading = /^## \[([^\]]+)\]/.exec(line);
    if (heading) {
      const version = parseVersion(heading[1]!);
      inside = version !== undefined && compareVersions(version, after) > 0 && compareVersions(version, upTo) <= 0;
    } else if (/^## |^\[[^\]]+\]: /.test(line)) {
      inside = false;
    }
    if (inside) lines.push(line);
  }
  return lines.join('\n').trim();
}

/** Whether a release's tag is signed, and if so whether git could check the signature, and why not. */
export type Signature = { state: 'verified' } | { state: 'unsigned' } | { state: 'unverified'; reason: string };

async function signatureOf(tag: string, run: Run): Promise<Signature> {
  let object: string;
  try {
    object = await run('git', ['cat-file', 'tag', tag]);
  } catch {
    return { state: 'unsigned' };
  }
  if (!/-----BEGIN (PGP|SSH) SIGNATURE-----/.test(object)) return { state: 'unsigned' };
  try {
    await run('git', ['verify-tag', tag]);
    return { state: 'verified' };
  } catch (error) {
    return { state: 'unverified', reason: said(error) };
  }
}

export interface Found {
  /** Why it couldn't look: not a git folder, or no connection. */
  problem?: string;
  /** The newest release with the same major version, if newer than the one running. */
  next?: { version: string; tag: string; notes: string; signature: Signature };
  /** The newest release with a later major version, which is installed by hand. */
  major?: string;
}

const NOT_A_CLONE = "The bot's folder isn't a git clone, so it can't be updated from here: see Updating in GUIDE.md";

/** Fetches the repository's tags, and looks among them for newer releases than `current`. */
export async function findUpdate(current: string, run: Run = runInRoot): Promise<Found> {
  try {
    await run('git', ['rev-parse', '--show-toplevel']);
  } catch {
    return { problem: NOT_A_CLONE };
  }
  try {
    await run('git', ['fetch', '--tags', '--quiet']);
  } catch (error) {
    return { problem: `Couldn't fetch the releases: ${said(error)}` };
  }
  const tags = (await run('git', ['tag', '--list', 'v*'])).split('\n').filter(Boolean);
  const { next, major } = newerReleases(tags, current);
  if (!next) return { major };
  const tag = `v${next}`;
  const notes = notesBetween(await run('git', ['show', `${tag}:CHANGELOG.md`]), current, next);
  return { next: { version: next, tag, notes, signature: await signatureOf(tag, run) }, major };
}

/** What `update` prints about what it found. */
export function describeUpdate(found: Found, current: string): string[] {
  if (found.problem) return [found.problem];
  const lines: string[] = [];
  const { next } = found;
  if (next) {
    const signature =
      next.signature.state === 'verified'
        ? 'its tag is signed, and the signature checks out'
        : next.signature.state === 'unsigned'
          ? "its tag isn't signed"
          : `its tag is signed, but git couldn't check the signature (${next.signature.reason})`;
    lines.push(`${next.version} is out, and this is ${current}; ${signature}. What changed:`, '', next.notes, '');
    lines.push(
      next.signature.state === 'unverified'
        ? 'Check the signature before updating to it.'
        : 'Type update apply to install it and restart the bot.',
    );
  } else {
    lines.push(`${current} is the latest ${current.split('.')[0]}.x release.`);
  }
  if (found.major) {
    lines.push(`${found.major} is out too, a new major version, which can need changes: read its notes, and update to it by hand (see Updating in GUIDE.md).`);
  }
  return lines;
}

/**
 * Installs the newest release with the same major version: checks out its tag and installs its dependencies, going
 * back to `current` if that fails. Only in a folder at `current`'s tag and without changes of its own, which an
 * update would mix with the release. Returns the version installed, for the bot to restart into, or why it didn't.
 */
export async function applyUpdate(current: string, say: (line: string) => void, run: Run = runInRoot): Promise<{ installed?: string; problem?: string }> {
  const here = `v${current}`;
  let tags: string[];
  try {
    tags = (await run('git', ['tag', '--points-at', 'HEAD'])).split('\n');
  } catch {
    return { problem: NOT_A_CLONE };
  }
  if (!tags.includes(here)) return { problem: `The bot's folder isn't checked out at ${here}, as an update expects: see Updating in GUIDE.md` };
  if ((await run('git', ['status', '--porcelain', '--untracked-files=no'])).trim()) {
    return { problem: "The bot's folder has changes of its own, which an update would mix with the release: undo them, or update by hand" };
  }

  const found = await findUpdate(current, run);
  if (found.problem) return { problem: found.problem };
  const { next } = found;
  if (!next) return { problem: `${current} is already the latest ${current.split('.')[0]}.x release` };
  if (next.signature.state === 'unverified') {
    return { problem: `${next.tag} is signed, but git couldn't check the signature (${next.signature.reason}): check it before updating` };
  }

  // Whatever fails, the bot goes on running the code it loaded; what matters is the folder it would start from again.
  const byHand = `before the bot starts again, run git checkout ${here} and pnpm install --prod in its folder`;
  say(`Installing ${next.version}…`);
  try {
    await run('git', ['checkout', '--quiet', next.tag]);
  } catch (error) {
    return { problem: `Checking out ${next.tag} failed (${said(error)}): check the folder with git status, and ${byHand}` };
  }
  try {
    await run('pnpm', ['install', '--prod', '--frozen-lockfile']);
  } catch (error) {
    say(`Installing its dependencies failed (${said(error)}): going back to ${current}…`);
    try {
      await run('git', ['checkout', '--quiet', here]);
      await run('pnpm', ['install', '--prod', '--frozen-lockfile']);
    } catch (back) {
      return { problem: `Going back to ${current} failed too (${said(back)}): ${byHand}` };
    }
    return { problem: `${next.version} wasn't installed, and the bot goes on running ${current}` };
  }
  return { installed: next.version };
}
