import { writeFileSync } from 'node:fs';
import { loadAppSettings } from '#src/config.ts';
import { buildManifest, exampleManifest, renderManifest } from './index.ts';

// `pnpm manifest`: writes the Slack app's manifest for this .env to manifest.yml, or prints it with --stdout (as from
// the Docker image, which has nowhere to write it).
// `pnpm manifest --example`: writes manifest.example.yml from the defaults, ignoring .env.

if (process.argv.includes('--example')) {
  writeFileSync('manifest.example.yml', exampleManifest());
  console.log('Wrote manifest.example.yml.');
} else {
  const { manifest, warnings } = buildManifest(loadAppSettings());
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  if (process.argv.includes('--stdout')) {
    process.stdout.write(renderManifest(manifest));
  } else {
    writeFileSync('manifest.yml', renderManifest(manifest));
    console.log('Wrote manifest.yml. Paste it into App Manifest (YAML) in the app settings: https://api.slack.com/apps');
  }
}
