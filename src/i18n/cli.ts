import { readFileSync, writeFileSync } from 'node:fs';
import { loadCatalog } from './catalog.ts';
import { check, generateTypes } from './generate.ts';

// `pnpm i18n`: updates src/i18n/messages.ts from locales/en.yml, and checks the other languages.

const typesFile = new URL('./messages.ts', import.meta.url);
const types = generateTypes(loadCatalog('en'));
let current = '';
try {
  current = readFileSync(typesFile, 'utf8');
} catch {
  // Not generated yet.
}
if (types !== current) {
  writeFileSync(typesFile, types);
  console.log('Updated src/i18n/messages.ts.');
}

const { errors, missing } = check();
for (const [language, keys] of missing) {
  if (keys.length > 0) console.log(`${language}: ${keys.length} texts not translated yet, shown in English:\n  ${keys.join('\n  ')}`);
}
for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log('Texts checked.');
