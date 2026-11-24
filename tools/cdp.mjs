// Minimal CDP driver: loads a page, collects console + errors, screenshots.
// usage: node cdp.mjs <url> <outPng> [waitMs] [evalExpr]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] || 6000);
const evalExpr = process.argv[5] || '';
const PORT = 9333;

const proc = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--window-size=1440,900',
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=' + 'C:\\Users\\andyd\\Documents\\deepseek-harness\\default-workspace\\MapForZZ7Z\\tools\\chromeprofile',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(p) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('chrome devtools not reachable');
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map(p=>p.name+'='+p.value) ?? '')).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${d.text} ${d.exception?.description || ''}`);
    } else if (m.method === 'Log.entryAdded') {
      logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text}`);
    }
  });

  await rpc(ws, ++id, 'Runtime.enable');
  await rpc(ws, ++id, 'Log.enable');
  await rpc(ws, ++id, 'Page.enable');
  await rpc(ws, ++id, 'Page.navigate', { url });
  await sleep(waitMs);

  if (evalExpr) {
    const res = await rpc(ws, ++id, 'Runtime.evaluate', {
      expression: evalExpr, returnByValue: true, awaitPromise: true,
    });
    console.log('EVAL:', JSON.stringify(res.result?.value ?? res.result, null, 1));
  }

  const shot = await rpc(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  console.log('--- console ---');
  console.log(logs.join('\n') || '(empty)');
  console.log(`saved ${out}`);
  ws.close();
} finally {
  proc.kill();
  await sleep(300);
}
