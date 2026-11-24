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
const ATTEMPTS = Number(process.env.CF_DEPLOY_ATTEMPTS || 4);

// wrangler 是 JS 入口，用当前 node 执行。
// 本机 IPv6 出口不通，Node 默认会优先连 AAAA 地址导致 fetch failed；
// 用 execArgv 给子进程加 IPv4 优先（比 NODE_OPTIONS 更可靠）。
const args = [
  '--dns-result-order=ipv4first',
  WRANGLER,
  'pages', 'deploy', WEB,
  '--project-name', PROJECT,
  '--branch', BRANCH,
  '--commit-dirty=true',
];

// api.cloudflare.com 从本机连接很慢，偶发 10s 连接超时 —— 失败就重试。
console.log(`deploying ${WEB} -> ${PROJECT} (${BRANCH})`);
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const res = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: WEB,
    env: process.env,
  });
  if (res.status === 0) process.exit(0);

  if (attempt === ATTEMPTS) {
    console.error(`deploy failed after ${ATTEMPTS} attempts (last exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
  const wait = attempt * 8;
  console.warn(`deploy attempt ${attempt} failed; retrying in ${wait}s ...`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
}
