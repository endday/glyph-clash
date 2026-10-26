// tools/eval.mjs — 在已打开的页面里执行一段 JS 并打印结果（配合 CDP 调试用）
// usage: node tools/eval.mjs <url> <js-file-or-inline> [w] [h]
import fs from 'node:fs';
import WS from 'ws';

const [url = 'http://127.0.0.1:5173/', src = '', w = '390', h = '844'] = process.argv.slice(2);
const code = src && fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : src;
const PORT = process.env.CDP_PORT || 9333;

const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WS(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let id = 0;
const pending = new Map();
const logs = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await sleep(2200);

const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
if (logs.length) console.log('--- logs ---\n' + logs.slice(-10).join('\n'));
ws.close();
