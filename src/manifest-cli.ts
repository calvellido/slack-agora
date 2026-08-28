import { writeFileSync } from 'node:fs';
import { loadAppSettings } from './config.ts';
import { buildManifest, exampleManifest, renderManifest } from './manifest.ts';

// `pnpm manifest`: writes the Slack app's manifest for this .env to manifest.yml.
// `pnpm manifest --example`: writes manifest.example.yml from the defaults, ignoring .env.

if (process.argv.includes('--example')) {
  writeFileSync('manifest.example.yml', exampleManifest());
  console.log('Wrote manifest.example.yml.');
} else {
  const { manifest, warnings } = buildManifest(loadAppSettings());
  writeFileSync('manifest.yml', renderManifest(manifest));
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  console.log('Wrote manifest.yml. Paste it into App Manifest (YAML) in the app settings: https://api.slack.com/apps');
}
