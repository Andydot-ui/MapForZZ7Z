// 通过 GitHub REST API（api.github.com，本机可直连）把 site/ 发布成 gh-pages 分支，
// 并开启 GitHub Pages。git push 直连 github.com 会被重置，故走 API。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const OWNER = 'Andydot-ui';
const REPO = 'MapForZZ7Z';
const SITE = 'C:\\Users\\andyd\\Documents\\deepseek-harness\\default-workspace\\MapForZZ7Z\\site';

function gh(args, input) {
  const r = spawnSync(GH, args, { encoding: 'utf8', input });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 本机到 api.github.com 偶发超时，逐次重试
function api(method, endpoint, payload, tries = 6) {
  const args = ['api', '--method', method, endpoint];
  if (payload) args.push('--input', '-');
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const out = gh(args, payload ? JSON.stringify(payload) : undefined);
      return out.trim() ? JSON.parse(out) : null;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message);
      // 404 之类是业务错误，不必重试
      if (/HTTP 404|HTTP 422|HTTP 409/.test(msg)) throw e;
      console.log(`  retry ${i + 1}/${tries} ${method} ${endpoint}`);
      sleep(1500 + i * 800);
    }
  }
  throw lastErr;
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

(async () => {
  const files = walk(SITE);
  console.log(`files: ${files.length}`);

  // 1) 为每个文件创建 blob
  const entries = [];
  for (const rel of files) {
    const p = path.join(SITE, rel);
    const buf = fs.readFileSync(p);
    const isText = /\.(html|css|js|svg)$/.test(rel);
    const blob = api('POST', `repos/${OWNER}/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    entries.push({
      path: rel,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
    console.log(`  blob ${rel} -> ${blob.sha.slice(0, 8)} (${buf.length} B)`);
  }

  // .nojekyll：避免 Pages 走 Jekyll
  const nojekyll = api('POST', `repos/${OWNER}/${REPO}/git/blobs`, {
    content: '', encoding: 'utf-8',
  });
  entries.push({ path: '.nojekyll', mode: '100644', type: 'blob', sha: nojekyll.sha });

  // 2) tree
  const tree = api('POST', `repos/${OWNER}/${REPO}/git/trees`, { tree: entries });
  console.log(`tree ${tree.sha}`);

  // 3) commit
  const commit = api('POST', `repos/${OWNER}/${REPO}/git/commits`, {
    message: 'deploy: MapForZZ7Z 产品介绍页',
    tree: tree.sha,
    parents: [],
  });
  console.log(`commit ${commit.sha}`);

  // 4) 建 ref（已存在则更新）
  let ref = null;
  try {
    ref = api('GET', `repos/${OWNER}/${REPO}/git/ref/heads/gh-pages`);
  } catch { ref = null; }
  if (ref) {
    api('PATCH', `repos/${OWNER}/${REPO}/git/refs/heads/gh-pages`, {
      sha: commit.sha, force: true,
    });
    console.log('ref updated');
  } else {
    api('POST', `repos/${OWNER}/${REPO}/git/refs`, {
      ref: 'refs/heads/gh-pages', sha: commit.sha,
    });
    console.log('ref created');
  }

  // 5) 开启 Pages（源 = gh-pages 分支根目录）
  // 若 Pages 已开启，POST 会返回 409/空体，此时不必重试，直接读回状态。
  try {
    const pages = api('POST', `repos/${OWNER}/${REPO}/pages`, {
      source: { branch: 'gh-pages', path: '/' },
    });
    console.log('pages enabled:', (pages && pages.html_url) || '(no body)');
  } catch (e) {
    console.log(`pages POST skipped: ${String(e.message).split('\n')[0]}`);
    try {
      const pages = api('PUT', `repos/${OWNER}/${REPO}/pages`, {
        source: { branch: 'gh-pages', path: '/' },
      });
      console.log('pages:', (pages && pages.html_url) || '(no body)');
    } catch (e2) {
      console.log(`pages PUT skipped: ${String(e2.message).split('\n')[0]}`);
    }
  }

  const info = api('GET', `repos/${OWNER}/${REPO}/pages`);
  console.log(JSON.stringify({
    url: (info && info.html_url) || null,
    status: (info && info.status) || null,
  }, null, 1));
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
