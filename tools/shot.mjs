// tools/shot.mjs  — CDP screenshot + JS eval helper
// usage: node tools/shot.mjs <url> <w> <h> <out.png> [dpr] [evalJS] [waitMs]
import fs from 'node:fs';

const [url, w = '360', h = '800', out = 'shot.png', dpr = '2', evalArg = '', waitMs = '1800'] =
  process.argv.slice(2);
const evalJS = evalArg || process.env.SHOT_EVAL || '';

const PORT = process.env.CDP_PORT || 9333;

async function newTarget() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  if (!r.ok) throw new Error('new target failed: ' + r.status);
  return r.json();
}

const t = await newTarget();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = new Map();

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method) {
    const fns = events.get(m.method);
    if (fns) fns.forEach((f) => f(m.params));
  }
});

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        rej(new Error('timeout ' + method));
      }
    }, 30000);
  });
}

function once(method) {
  return new Promise((res) => {
    const fns = events.get(method) || [];
    const f = (p) => {
      events.set(method, fns.filter((x) => x !== f));
      res(p);
    };
    events.set(method, [...fns, f]);
  });
}

await new Promise((res) => ws.addEventListener('open', res));

const logs = [];
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
events.set('Runtime.consoleAPICalled', [
  (p) => logs.push('[console.' + p.type + '] ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ')),
]);
events.set('Runtime.exceptionThrown', [
  (p) => logs.push('[exception] ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)),
]);
events.set('Log.entryAdded', [(p) => logs.push('[' + p.entry.level + '] ' + p.entry.text)]);

await send('Emulation.setDeviceMetricsOverride', {
  width: +w,
  height: +h,
  deviceScaleFactor: +dpr,
  mobile: +w < 600,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: +w < 600 });

const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url });
await loaded.catch(() => {});
await new Promise((r) => setTimeout(r, +waitMs));

let evaluated = null;
if (evalJS) {
  const r = await send('Runtime.evaluate', {
    expression: evalJS,
    returnByValue: true,
    awaitPromise: true,
  });
  evaluated = r.result?.value ?? r.result?.description ?? null;
}

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

if (logs.length) console.log('--- logs ---\n' + logs.slice(0, 40).join('\n'));
if (evaluated !== null) console.log('--- eval ---\n' + JSON.stringify(evaluated, null, 2));
console.log('saved ' + out);
await send('Page.close').catch(() => {});
ws.close();
process.exit(0);
