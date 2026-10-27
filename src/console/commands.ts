import type { Activity } from '#src/activity.ts';
import { LEVELS as ALL_LEVELS, type Level, type Log } from '#src/log.ts';
import type { Command } from './index.ts';
import { statusLines, type StatusInfo } from './status.ts';
import { applyUpdate, describeUpdate, findUpdate, runInRoot, type Run } from './update.ts';

interface Context {
  log: Log;
  activity: Activity;
  /** What the status shows besides the activity, as it is now. */
  info: () => StatusInfo;
  /** Stops the bot for the launcher to start it again; undefined when no launcher started it. */
  restart?: () => void;
  run?: Run;
}

/** The levels the console can set, up to trace. Bolt's debug isn't one: it prints whole messages, with names and text. */
const LEVELS = ALL_LEVELS.slice(0, ALL_LEVELS.indexOf('trace') + 1);

const NO_LAUNCHER = 'Only when the bot was started with pnpm start, which starts it again. pnpm dev restarts it when a file changes.';

export function consoleCommands({ log, activity, info, restart, run = runInRoot }: Context): Record<string, Command> {
  return {
    status: {
      usage: 'status',
      help: 'how the bot is doing',
      run: () => statusLines(activity, info(), Date.now()),
    },

    log: {
      usage: `log [${LEVELS.join('|')}]`,
      help: "shows the log's level, or changes it until the bot stops",
      run: ([level]) => {
        if (!level) return `The log's level is ${log.level}`;
        if (level === 'debug') return "Not from here: debug prints whole messages, with names and what people wrote, even anonymously";
        if (!LEVELS.includes(level as Level)) return `There's no level ${level}: it's one of ${LEVELS.join(', ')}`;
        log.level = level as Level;
        const trace = level === 'trace' ? ', with a line for each event, action or command, without names or text' : '';
        return `The log's level is ${level} until the bot stops${trace}`;
      },
    },

    restart: {
      usage: 'restart',
      help: 'stops the bot and starts it again, with .env read again',
      run: (_, say) => {
        if (!restart) return NO_LAUNCHER;
        say('Restarting…');
        restart();
      },
    },

    update: {
      usage: 'update [apply]',
      help: 'looks for a newer release; with apply, installs it and restarts',
      run: async ([action], say) => {
        const current = info().version;
        if (action === undefined) return describeUpdate(await findUpdate(current, run), current);
        if (action !== 'apply') return 'Type update to look for a newer release, or update apply to install it';
        if (!restart) return NO_LAUNCHER;
        const { installed, problem } = await applyUpdate(current, say, run);
        if (!installed) return problem;
        say(`Installed ${installed}: restarting…`);
        // Nothing goes back by itself if the new version doesn't start.
        say(`If it doesn't start, go back with git checkout v${current} and pnpm install --prod, and start it again`);
        restart();
      },
    },
  };
}
