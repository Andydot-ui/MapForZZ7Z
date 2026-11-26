// Minimal static file server for local preview / verification.
// Mirrors the Cloudflare Pages routes declared in web/_redirects so that
// /map and /3d can be checked locally before deploying.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PORT = Number(process.argv[3] || 8787);

// Same table as _redirects. Cloudflare Pages serves map.html at /map through
// clean-URL normalisation, so /map must NOT rewrite to /map.html (that loops).
const ROUTES = {
  '/': ['/map', 302],
  '/map': ['/map.html', 200],
  '/3d': ['/3d.html', 200],
  '/map.html': ['/map.html', 200],
  '/3d.html': ['/3d.html', 200],
  '/index.html': ['/map', 301],
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function sendFile(res, rel, status = 200, extra = {}) {
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(status, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const route = ROUTES[rel];
  if (route) {
    const [target, status] = route;
    if (status === 301) {
      res.writeHead(301, { Location: target }).end();
      return;
    }
    sendFile(res, target);
    return;
  }
  sendFile(res, rel);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
