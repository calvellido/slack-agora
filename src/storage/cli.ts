import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { databasePath } from '#src/config.ts';
import { emptyDatabase, openDatabase, rowCounts } from './database.ts';

// `pnpm clean-db`: empties the database, after asking, so the bot starts over as on its first run. It works with the
// bot running. `pnpm clean-db --yes` doesn't ask.

const path = databasePath();
if (!existsSync(path)) {
  console.log(`There is no database at ${path}.`);
  process.exit(0);
}
const db = openDatabase(path);
const counts = [...rowCounts(db)].filter(([, count]) => count > 0);
if (counts.length === 0) {
  console.log(`${path} is already empty.`);
  process.exit(0);
}

console.log(`${path} holds ${counts.map(([table, count]) => `${table}: ${count}`).join(', ')}.`);
console.log(
  "Emptying it can't be undone. Threads already in the team channel stay, but they are no longer conversations: " +
    "replies from them aren't sent, people's next messages start new threads, anonymous conversations disappear " +
    "from their authors' windows, and the text of encrypted ones is lost for good, as it is only kept here.",
);
if (!process.argv.includes('--yes')) {
  if (!process.stdin.isTTY) {
    console.error('Run `pnpm clean-db --yes` to empty it without asking.');
    process.exit(1);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('Empty it? [y/N] ');
  prompt.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Nothing was deleted.');
    process.exit(0);
  }
}
emptyDatabase(db);
db.close();
console.log(`Emptied ${path}.`);
