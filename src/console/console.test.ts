import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { Log } from '#src/log.ts';
import { startConsole, type Command } from './index.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The console reading what `type` types, with what it prints and how often it stopped the bot recorded. */
function setup(t: TestContext, commands: Record<string, Command>) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = '';
  output.on('data', (data) => (printed += data));
  const log = new Log();
  const ownWrite = log.write;
  let stops = 0;
  const terminal = startConsole(commands, { log, stop: () => stops++, input, output });
  t.after(() => terminal.close());
  const type = async (line: string) => {
    printed = '';
    input.write(`${line}\n`);
    await wait(10);
    // Without the prompts, which aren't on lines of their own.
    return printed.replaceAll('> ', '').split('\n').filter(Boolean);
  };
  return { type, input, log, ownWrite, terminal, stops: () => stops };
}

const echo: Command = { usage: 'echo [words]', help: 'says the words back', run: (args) => args.join(' ') };

test('help lists the commands, and what each does', async (t) => {
  const { type } = setup(t, { echo });
  assert.deepEqual(await type('help'), ['  help           lists the commands', '  echo [words]   says the words back']);
});

test("a command prints what it says while running and what it returns, and one that doesn't exist says so", async (t) => {
  const slow: Command = {
    usage: 'slow',
    help: 'takes its time',
    run: async (_, say) => {
      say('Starting…');
      return ['Done', 'Really'];
    },
  };
  const { type } = setup(t, { echo, slow });
  assert.deepEqual(await type('  echo  hello   there '), ['hello there']);
  assert.deepEqual(await type('slow'), ['Starting…', 'Done', 'Really']);
  assert.deepEqual(await type('nope'), ["There's no command nope: type help to see them"]);
  assert.deepEqual(await type('toString'), ["There's no command toString: type help to see them"]);
  assert.deepEqual(await type(''), []);
});

test('a command can close the console, as restart does, and it then prompts no more', async (t) => {
  let close = () => {};
  const restart: Command = {
    usage: 'restart',
    help: 'restarts',
    run: (_, say) => {
      say('Restarting…');
      close();
    },
  };
  const { type, terminal } = setup(t, { restart });
  close = () => terminal.close();
  // Readline throws when asked to prompt once closed, which would end the bot before it shut down.
  assert.deepEqual(await type('restart'), ['Restarting…']);
});

test('a failing command says why, and another waits for one still running', async (t) => {
  let finish = () => {};
  const commands: Record<string, Command> = {
    fail: { usage: 'fail', help: 'fails', run: () => Promise.reject(new Error('no connection')) },
    hang: { usage: 'hang', help: 'waits', run: () => new Promise<void>((resolve) => (finish = resolve)) },
  };
  const { type } = setup(t, commands);
  assert.deepEqual(await type('fail'), ['fail failed: no connection']);
  await type('hang');
  assert.deepEqual(await type('fail'), ['Wait: hang is still running']);
  finish();
});

test('log lines go through the console while it is open, and Ctrl-D stops the bot, unlike closing it', async (t) => {
  const { input, log, ownWrite, stops } = setup(t, {});
  assert.notEqual(log.write, ownWrite);
  input.end();
  await wait(10);
  assert.equal(stops(), 1);

  const other = setup(t, {});
  other.terminal.close();
  assert.equal(other.log.write, other.ownWrite);
  assert.equal(other.stops(), 0);
});
