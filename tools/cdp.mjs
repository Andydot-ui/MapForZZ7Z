// Minimal CDP driver: loads a page, collects console + errors, screenshots.
// usage: node cdp.mjs <url> <outPng> [waitMs] [evalExpr]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] || 6000);
let evalExpr = process.argv[5] || '';
// 多行脚本走 @file，避免命令行转义把表达式弄坏
if (evalExpr.startsWith('@')) {
  evalExpr = fs.readFileSync(evalExpr.slice(1), 'utf8');
}
const MOBILE = process.env.CDP_MOBILE === '1';
// CDP_SCHEME=light|dark 强制 prefers-color-scheme（headless Chrome 默认是 dark）
const SCHEME = process.env.CDP_SCHEME || '';
const VW = Number(process.env.CDP_W || (MOBILE ? 390 : 1440));
const VH = Number(process.env.CDP_H || (MOBILE ? 844 : 900));
// CDP_DPR=2 出视网膜级截图（用于产品介绍页素材）
const DPR = Number(process.env.CDP_DPR || (MOBILE ? 3 : 1));
const PORT = 9333;

const proc = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  `--window-size=${VW},${VH}`,
  '--no-first-run',
  '--no-default-browser-check',
  // 可选：CDP_HOST_RULES="MAP example.com 1.2.3.4"，用于本地 DNS 解析不了的自定义域名
  ...(process.env.CDP_HOST_RULES ? ['--host-resolver-rules=' + process.env.CDP_HOST_RULES] : []),
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
    } else if (m.method === 'Network.responseReceived' && process.env.CDP_NET === '1') {
      const r = m.params.response;
      if (r.status >= 400) logs.push(`[net ${r.status}] ${r.url}`);
    }
  });

  await rpc(ws, ++id, 'Runtime.enable');
  await rpc(ws, ++id, 'Log.enable');
  await rpc(ws, ++id, 'Page.enable');
  if (process.env.CDP_NET === '1') await rpc(ws, ++id, 'Network.enable');
  if (SCHEME) {
    await rpc(ws, ++id, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: SCHEME }],
    });
  }
  if (MOBILE) {
    await rpc(ws, ++id, 'Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: DPR, mobile: true,
    });
    await rpc(ws, ++id, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else if (DPR !== 1) {
    await rpc(ws, ++id, 'Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: DPR, mobile: false,
    });
  }
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
