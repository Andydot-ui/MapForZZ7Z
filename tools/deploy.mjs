// Deploy web/ to Cloudflare Pages (Direct Upload).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const WRANGLER = path.join(HERE, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PROJECT = process.env.CF_PAGES_PROJECT || 'mapforzz7z';
const BRANCH = process.env.CF_PAGES_BRANCH || 'main';

// wrangler is a JS entry point; run it with the current node binary
const args = [
  WRANGLER,
  'pages', 'deploy', WEB,
  '--project-name', PROJECT,
  '--branch', BRANCH,
  '--commit-dirty=true',
];

console.log(`deploying ${WEB} -> ${PROJECT} (${BRANCH})`);
const res = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  cwd: WEB,
  env: process.env,
});

if (res.status !== 0) {
  console.error('deploy failed with exit code', res.status);
  process.exit(res.status ?? 1);
}
