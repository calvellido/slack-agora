import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyUpdate, describeUpdate, findUpdate, newerReleases, notesBetween, type Run } from './update.ts';

const CHANGELOG = `# Changelog

What changed in each version.

## [Unreleased]

- Not out yet.

## [3.2.0] - 2026-11-02

- A new thing.

## [3.1.1] - 2026-10-30

- A fix.

## [3.1.0] - 2026-10-23

- What is running.

[3.2.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.2.0
[3.1.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.1.0
`;

test('the next release is the newest of the same major version, and a later major one is told apart', () => {
  const tags = ['v2.9.0', 'v3.0.0', 'v3.1.0', 'v3.2.0', 'v3.10.1', 'v4.0.0', 'v4.1.0', 'not-a-release'];
  assert.deepEqual(newerReleases(tags, '3.1.0'), { next: '3.10.1', major: '4.1.0' });
  assert.deepEqual(newerReleases(tags, '3.10.1'), { next: undefined, major: '4.1.0' });
  assert.deepEqual(newerReleases(tags, '4.1.0'), { next: undefined, major: undefined });
});

test('the notes are the changelog sections after the running version, up to the next one', () => {
  assert.equal(notesBetween(CHANGELOG, '3.1.0', '3.2.0'), '## [3.2.0] - 2026-11-02\n\n- A new thing.\n\n## [3.1.1] - 2026-10-30\n\n- A fix.');
});

/**
 * git and pnpm in a folder cloned at v3.1.0, with v3.2.0 released and its tag not signed. `replies` change what a
 * command, by how its line starts, prints, or throws.
 */
function folder(replies: Record<string, () => string> = {}) {
  const calls: string[] = [];
  const defaults: Record<string, () => string> = {
    'git tag --points-at HEAD': () => 'v3.1.0\n',
    'git tag --list': () => 'v3.0.0\nv3.1.0\nv3.2.0\n',
    'git show v3.2.0:CHANGELOG.md': () => CHANGELOG,
    'git cat-file tag v3.2.0': () => 'object 1234\ntype commit\ntag v3.2.0\n\nchore: release v3.2.0\n',
  };
  const all = { ...defaults, ...replies };
  const run: Run = async (command, args) => {
    const line = [command, ...args].join(' ');
    calls.push(line);
    return Object.entries(all).find(([start]) => line.startsWith(start))?.[1]() ?? '';
  };
  return { run, calls };
}

const failing = (stderr: string) => () => {
  throw Object.assign(new Error('Command failed'), { stderr });
};

test('update says what the next release changes, and that its tag is not signed', async () => {
  const { run } = folder();
  const lines = describeUpdate(await findUpdate('3.1.0', run), '3.1.0');
  assert.equal(lines[0], "3.2.0 is out, and this is 3.1.0; its tag isn't signed. What changed:");
  assert.ok(lines.includes('## [3.2.0] - 2026-11-02\n\n- A new thing.\n\n## [3.1.1] - 2026-10-30\n\n- A fix.'));
  assert.equal(lines.at(-1), 'Type update apply to install it and restart the bot.');
});

test("update says why it couldn't look", async () => {
  const { run } = folder({ 'git fetch': failing('fatal: unable to access the repository\nmore') });
  assert.deepEqual(describeUpdate(await findUpdate('3.1.0', run), '3.1.0'), ["Couldn't fetch the releases: fatal: unable to access the repository"]);
});

test('applying an update checks out the next release and installs its dependencies', async () => {
  const { run, calls } = folder();
  const said: string[] = [];
  assert.deepEqual(await applyUpdate('3.1.0', (line) => said.push(line), run), { installed: '3.2.0' });
  assert.deepEqual(calls.slice(-2), ['git checkout --quiet v3.2.0', 'pnpm install --prod --frozen-lockfile']);
  assert.deepEqual(said, ['Installing 3.2.0…']);
});

test('an update is only applied in a clean folder at the running release, and not with a signature that fails', async () => {
  const cases = [
    folder({ 'git tag --points-at HEAD': () => '' }),
    folder({ 'git status': () => ' M src/main.ts\n' }),
    folder({
      'git cat-file tag v3.2.0': () => 'tag v3.2.0\n-----BEGIN SSH SIGNATURE-----\n',
      'git verify-tag': failing('error: gpg.ssh.allowedSignersFile needs to be configured'),
    }),
  ];
  for (const { run, calls } of cases) {
    const { installed, problem } = await applyUpdate('3.1.0', () => {}, run);
    assert.equal(installed, undefined);
    assert.ok(problem);
    assert.ok(!calls.some((c) => c.startsWith('git checkout')));
  }
});

test('when its dependencies fail to install, the folder goes back to the running release', async () => {
  let installs = 0;
  const { run, calls } = folder({
    'pnpm install': () => {
      if (++installs === 1) throw Object.assign(new Error('Command failed'), { stderr: 'ERR_PNPM_FETCH_404' });
      return '';
    },
  });
  const { installed, problem } = await applyUpdate('3.1.0', () => {}, run);
  assert.equal(installed, undefined);
  assert.equal(problem, "3.2.0 wasn't installed, and the bot goes on running 3.1.0");
  assert.deepEqual(calls.slice(-3), ['pnpm install --prod --frozen-lockfile', 'git checkout --quiet v3.1.0', 'pnpm install --prod --frozen-lockfile']);
});

test('when going back fails too, or the release can’t be checked out, it says how to fix the folder by hand', async () => {
  const back = folder({ 'pnpm install': failing('ERR_PNPM_FETCH_404') });
  const { problem } = await applyUpdate('3.1.0', () => {}, back.run);
  assert.equal(problem, 'Going back to 3.1.0 failed too (ERR_PNPM_FETCH_404): before the bot starts again, run git checkout v3.1.0 and pnpm install --prod in its folder');

  const checkout = folder({ 'git checkout': failing('error: The following untracked working tree files would be overwritten by checkout') });
  const { problem: notCheckedOut } = await applyUpdate('3.1.0', () => {}, checkout.run);
  assert.match(notCheckedOut!, /^Checking out v3\.2\.0 failed \(error: The following untracked/);
  assert.ok(!checkout.calls.some((c) => c.startsWith('pnpm')));
});
