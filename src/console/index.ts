import { clearLine, createInterface, cursorTo } from 'node:readline';
import type { Log } from '#src/log.ts';

// The console: when the bot runs in a terminal, commands typed there, one per line, such as `status`. Log lines print
// above what is being typed, so they don't break it. Ctrl-C and Ctrl-D stop the bot, as they would without it.

export interface Command {
  /** How to type it, for `help`: `log [level]`. */
  usage: string;
  help: string;
  /** Runs it with the words typed after its name; `say` prints a line at once. Returns what to print at the end. */
  run(args: string[], say: (line: string) => void): Promise<Output> | Output;
}

type Output = string | string[] | void;

interface Options {
  log: Log;
  stop: () => void;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export function startConsole(commands: Record<string, Command>, options: Options): { close(): void } {
  const { log, stop, input = process.stdin, output = process.stdout } = options;
  const rl = createInterface({ input, output, prompt: '> ', historySize: 100 });
  // Once closed, as when a command restarts the bot, it no longer prompts: readline throws if asked to.
  let closed = false;
  rl.on('close', () => (closed = true));
  const prompt = (preserveCursor?: boolean) => {
    if (!closed) rl.prompt(preserveCursor);
  };

  /** Prints a line above the prompt, and draws it again with what was being typed. */
  const print = (line: string, stream: NodeJS.WritableStream = output) => {
    const drawn = rl.terminal && !closed;
    if (drawn) {
      clearLine(output, 0);
      cursorTo(output, 0);
    }
    stream.write(`${line}\n`);
    if (drawn) prompt(true);
  };
  const writeLog = log.write;
  log.write = (line, stream) => print(line, stream);

  const help: Command = {
    usage: 'help',
    help: 'lists the commands',
    run: () => {
      const all = [help, ...Object.values(commands)];
      const width = Math.max(...all.map((c) => c.usage.length));
      return all.map((c) => `  ${c.usage.padEnd(width)}   ${c.help}`);
    },
  };

  let running: string | undefined;
  rl.on('line', async (typed) => {
    const [name, ...args] = typed.trim().split(/\s+/);
    if (!name) return prompt();
    if (running) return print(`Wait: ${running} is still running`);
    // Only its own commands, not what every object has, such as toString.
    const command = name === 'help' ? help : Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (!command) {
      print(`There's no command ${name}: type help to see them`);
      return prompt();
    }
    running = name;
    warned = false;
    try {
      const out = await command.run(args, (line) => print(line));
      for (const line of [out ?? []].flat()) print(line);
    } catch (error) {
      print(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = undefined;
      prompt();
    }
  });

  // In a terminal, the console reads keys itself, so Ctrl-C comes to it rather than as a signal. While a command
  // runs, such as an update halfway through installing, it asks for a second one, so as not to leave it half done.
  let closing = false;
  let warned = false;
  rl.on('SIGINT', () => {
    if (running && !warned) {
      warned = true;
      return print(`${running} is still running: press Ctrl-C again to stop the bot anyway`);
    }
    stop();
  });
  rl.on('close', () => {
    if (!closing) stop();
  });

  print('Type help to see the commands you can type here.');
  prompt();
  return {
    close() {
      closing = true;
      log.write = writeLog;
      rl.close();
    },
  };
}
