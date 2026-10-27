import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LAUNCHED_ENV, RESTART_CODE } from './console/restart.ts';

// What `pnpm start` runs: the bot (main.ts) in a process of its own, started again whenever it exits asking to, after
// the console's restart or update, and when it fails after running for a while, as a service would. The bot reads
// .env each time it starts, so a restart also picks up changed settings; the launcher reads none of it.

const main = fileURLToPath(new URL('./main.ts', import.meta.url));

/** A bot failing sooner than this after starting, as with wrong settings, would only fail again: it isn't restarted. */
const FAILS_AT_START_MS = 60_000;
const RESTART_AFTER_FAILURE_MS = 10_000;

/** The bot running, if it is. */
let bot: ChildProcess | undefined;
/** The exit code of a bot that failed, while waiting to start it again. */
let failedWith: number | undefined;
/** Once the launcher is asked to stop, a bot that exits isn't started again, however it ended. */
let stopping = false;

function start(): void {
  failedWith = undefined;
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', main], {
    stdio: 'inherit',
    env: { ...process.env, [LAUNCHED_ENV]: '1' },
  });
  bot = child;
  child.on('exit', (code) => {
    bot = undefined;
    if (stopping) process.exit(code ?? 1);
    if (code === RESTART_CODE) return start();
    if (code !== 0 && Date.now() - startedAt > FAILS_AT_START_MS) {
      console.error(`The bot stopped with ${code === null ? 'a signal' : `exit code ${code}`}: starting it again in ${RESTART_AFTER_FAILURE_MS / 1000} s`);
      failedWith = code ?? 1;
      setTimeout(start, RESTART_AFTER_FAILURE_MS);
      return;
    }
    process.exit(code ?? 1);
  });
}

// Asked to stop, it tells the bot once, which shuts down by itself, and then exits; while waiting to start a failed
// bot again, it exits at once. Ctrl-C in the terminal also reaches the bot, which handles both signals the same way.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!bot) process.exit(failedWith ?? 1);
    if (!stopping) bot.kill('SIGTERM');
    stopping = true;
  });
}
start();
