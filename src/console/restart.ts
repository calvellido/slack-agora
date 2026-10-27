// Between the bot and the launcher that `pnpm start` runs (src/launcher.ts), which starts it again when it asks to.
// Apart from both, so the launcher loads nothing else.

/** The exit code with which the bot asks the launcher to start it again. */
export const RESTART_CODE = 75;

/** Set for the bot by the launcher. */
export const LAUNCHED_ENV = 'AGORA_LAUNCHED';

/** Whether the bot was started by the launcher, and so can be started again by exiting with RESTART_CODE. */
export function launched(): boolean {
  return process.env[LAUNCHED_ENV] === '1';
}
